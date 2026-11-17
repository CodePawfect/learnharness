import { createHash, randomUUID } from "node:crypto";
import type { Usage } from "@earendil-works/pi-ai";
import type { ChatRecord } from "../core/contracts.ts";
import type { ChatStore } from "../core/ports.ts";
import { emit } from "../core/events.ts";
import { LearningError, learningObject } from "../core/learning.ts";
import {
	applyFlashcardCommand, currentFlashcardAttempt, flashcardIdentity, flashcardSnapshot, parseAssessment,
	type Flashcard, type FlashcardData, type FlashcardStore,
} from "../core/flashcards.ts";
import { assessFlashcard, flashcardTranscript, generateFlashcards, type FlashcardGeneration } from "../agent/flashcards.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { connectionBackgroundAllowed } from "../agent/subscription-connections.ts";
import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { effectiveSettings, stores } from "./stores.ts";
import { providerKeyPresent } from "./keys.ts";
import { refreshConnectionCatalog } from "./model-catalog.ts";

export function flashcardFingerprint(record: ChatRecord): string { return createHash("sha256").update(flashcardTranscript(record)).digest("hex"); }

/** Atomic upserts preserve card identity, old attempt snapshots, and review dates. */
export function mergeFlashcards(data: FlashcardData, record: ChatRecord, output: FlashcardGeneration, now: number, newId: () => string, checkpointComplete = true) {
	const at = new Date(now).toISOString();
	for (const draft of output.cards) {
		let topic = data.topics.find(t => flashcardIdentity(t.name) === flashcardIdentity(draft.topic));
		if (!topic) { topic = { id: newId(), name: draft.topic.trim(), createdAt: at }; data.topics.push(topic); }
		const matching = data.cards.find(c => c.id === draft.existingCardId) ??
			data.cards.find(c => c.topicId === topic!.id && (flashcardIdentity(c.concept) === flashcardIdentity(draft.concept) || flashcardIdentity(c.question) === flashcardIdentity(draft.question)));
		const source = { chatId: record.id, messageIds: [...new Set([draft.teachingMessageId, draft.learnerMessageId, draft.feedbackMessageId])] };
		if (matching) {
			matching.topicId = topic.id; matching.concept = draft.concept.trim(); matching.question = draft.question.trim();
			matching.answer = draft.answer.trim(); matching.criteria = draft.criteria.trim(); matching.updatedAt = at;
			const old = matching.sources.find(s => s.chatId === record.id);
			if (old) old.messageIds = [...new Set([...old.messageIds, ...source.messageIds])]; else matching.sources.push(source);
		} else data.cards.push({ id: newId(), topicId: topic.id, concept: draft.concept.trim(), question: draft.question.trim(),
			answer: draft.answer.trim(), criteria: draft.criteria.trim(), sources: [source], createdAt: at, updatedAt: at });
	}
	if (!checkpointComplete) return;
	const checkpoint = { chatId: record.id, fingerprint: flashcardFingerprint(record), checkedAt: at, deferred: output.deferred };
	const old = data.checkpoints.find(c => c.chatId === record.id);
	if (old) Object.assign(old, checkpoint); else data.checkpoints.push(checkpoint);
}

interface ServiceDeps {
	store: FlashcardStore; chats: Pick<ChatStore, "getChat"> & { listChats(): Array<{ id: string }> };
	generate: (record: ChatRecord, data: FlashcardData, signal: AbortSignal) => Promise<FlashcardGeneration>;
	grade: (card: Flashcard, answer: string, signal: AbortSignal) => Promise<ReturnType<typeof parseAssessment>>;
	busy?: (chatId: string) => boolean;
	notify?: () => void;
}

/** One serial queue spans routes and live turns. No timer, chat mutation or synthetic tutor turn. */
export function createFlashcardService(deps: ServiceDeps) {
	const queued = new Set<string>(), failures = new Map<string, { chatId: string; title: string; message: string; fingerprint: string }>();
	const grading = new Map<string, Promise<void>>();
	let running: Promise<void> | undefined, currentTitle: string | undefined;
	const notify = () => deps.notify?.();
	const fingerprintChanged = (record: ChatRecord) => deps.store.read().checkpoints.find(c => c.chatId === record.id)?.fingerprint !== flashcardFingerprint(record);
	const drain = async () => {
		while (queued.size) {
			const id = queued.values().next().value!; queued.delete(id);
			let record: ChatRecord | null = null;
			try {
				record = deps.chats.getChat(id);
				if (!record || !record.messages.length || deps.busy?.(id) || !fingerprintChanged(record)) continue;
				currentTitle = record.title; notify();
				const fingerprint = flashcardFingerprint(record);
				let more = true, pages = 0;
				while (more) {
					if (++pages > 32) throw new Error("This session needs more processing. Retry to continue from the saved cards.");
					const before = deps.store.read();
					const output = await deps.generate(record, before, AbortSignal.timeout(180_000));
					const fresh = deps.chats.getChat(id);
					if (!fresh) break;
					// A newer turn may correct the material. Never commit an outdated interpretation.
					if (flashcardFingerprint(fresh) !== fingerprint || deps.busy?.(id)) { queued.add(id); break; }
					more = output.moreReady === true;
					deps.store.update(data => mergeFlashcards(data, fresh, output, Date.now(), () => `fc_${randomUUID()}`, !more));
					if (more && JSON.stringify(deps.store.read().cards.map(c => [c.id, c.question, c.answer, c.criteria])) === JSON.stringify(before.cards.map(c => [c.id, c.question, c.answer, c.criteria]))) throw new Error("The tutor reported more material but returned no new cards. Retry lesson processing.");
				}
				failures.delete(id);
			} catch (error) {
				failures.set(id, { chatId: id, title: record?.title ?? "Learning session", message: error instanceof Error ? error.message : "Could not create flashcards.", fingerprint: record ? flashcardFingerprint(record) : "" });
			} finally { currentTitle = undefined; notify(); }
		}
	};
	const enqueue = (id: string, retry = false) => {
		const record = deps.chats.getChat(id);
		if (!record || !record.messages.length || !fingerprintChanged(record)) return;
		const failure = failures.get(id);
		if (!retry && failure?.fingerprint === flashcardFingerprint(record)) return;
		if (retry) failures.delete(id);
		queued.add(id);
		if (!running) {
			// Start on a microtask so running is installed before the first notification.
			running = Promise.resolve().then(drain).finally(() => { running = undefined; notify(); });
		}
		notify();
	};
	return {
		enqueue,
		sync(retry = false) { for (const chat of deps.chats.listChats()) enqueue(chat.id, retry); },
		async settled() { await running; },
		snapshot() {
			const data = deps.store.read();
			return { ...flashcardSnapshot(data, Date.now()), sync: { running: !!running, pending: queued.size, currentTitle, errors: [...failures.values()].map(({ fingerprint: _f, ...e }) => e) } };
		},
		async command(raw: unknown) {
			const input = learningObject(raw);
			if (input.action === "sync") { this.sync(true); return this.snapshot(); }
			deps.store.update(data => applyFlashcardCommand(data, input, Date.now(), () => `fc_${randomUUID()}`));
			if (input.action === "answer") {
				const attempt = currentFlashcardAttempt(deps.store.read());
				if (attempt?.answer && !attempt.assessment) {
					let task = grading.get(attempt.id);
					if (!task) {
						task = (async () => {
							let result: ReturnType<typeof parseAssessment>;
							try { result = parseAssessment(await deps.grade(attempt.card, attempt.answer!, AbortSignal.timeout(90_000))); }
							catch { throw new LearningError("Your answer is saved. The tutor could not complete its assessment. Retry assessment or check your tutor connection.", 503); }
							deps.store.update(data => {
								const active = currentFlashcardAttempt(data);
								if (active?.id === attempt.id && !active.assessment) active.assessment = { ...result, gradedAt: new Date().toISOString() };
							});
						})().finally(() => grading.delete(attempt.id));
						grading.set(attempt.id, task);
					}
					await task;
				}
			}
			return this.snapshot();
		},
	};
}

async function tutor(record?: ChatRecord, background = false) {
	const spec = resolveConversationSpec(record?.settings, effectiveSettings().models.strong);
	if (!spec) throw new LearningError("Choose a tutor model in Settings → Models to create and assess flashcards.", 503);
	await refreshConnectionCatalog(spec.provider);
	if (background && !connectionBackgroundAllowed(spec.provider)) throw new LearningError("Automatic flashcards are waiting for background access to your connected tutor. Enable background access in Settings → Providers, then retry.", 503);
	if (!providerKeyPresent(spec.provider)) throw new LearningError("Connect your configured tutor provider in Settings → Providers, then retry.", 503);
	return piEngineForSpec(spec, background);
}

function callUsage(usage: Usage) {
	return { inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead,
		cacheWriteTokens: usage.cacheWrite, cacheWrite1hTokens: usage.cacheWrite1h ?? 0, reasoningTokens: usage.reasoning ?? 0 };
}

const globalService = globalThis as typeof globalThis & { __lhFlashcardService?: ReturnType<typeof createFlashcardService> };
export function flashcardService() {
	return globalService.__lhFlashcardService ??= createFlashcardService({
		store: stores.flashcardStore, chats: stores.chatStore, notify: () => emit("flashcards-changed", {}),
		busy: id => isTurnRunning(id),
		generate: (record, data, signal) => withBgLlmSlot(signal, async () => {
			const engine = await tutor(record, true), usageId = `fc_${randomUUID()}`;
			return generateFlashcards(record, data, engine, signal, (usage, model) => {
				if (stores.chatStore.getChat(record.id)) stores.chatStore.appendTurnUsage(record.id, { id: `${usageId}_${randomUUID()}`, messageId: record.messages.at(-1)!.id, at: new Date().toISOString(), model, steps: [callUsage(usage)] });
			});
		}),
		grade: async (card, answer, signal) => {
			const record = stores.chatStore.getChat(card.sources[0]!.chatId) ?? undefined;
			const engine = await tutor(record);
			return assessFlashcard(card, answer, engine, signal, (usage, model) => {
				if (record && stores.chatStore.getChat(record.id)) stores.chatStore.appendTurnUsage(record.id, { id: `fc_${randomUUID()}`, messageId: record.messages.at(-1)!.id, at: new Date().toISOString(), model, steps: [callUsage(usage)] });
			});
		},
	});
}

// Imported at the bottom to keep the queue independent of the chat-handler composition.
import { isTurnRunning } from "./turn-liveness.ts";

export function triggerFlashcards(chatId: string) {
	if (process.env.NODE_ENV === "test") return;
	try { flashcardService().enqueue(chatId); }
	catch (error) { console.error("[flashcards] could not queue session", error instanceof Error ? error.message : "storage unavailable"); }
}

export function flashcardErrorResponse(error: unknown): Response {
	return Response.json({ error: error instanceof LearningError ? error.message : "Could not load or save flashcards. Retry; existing data is preserved." },
		{ status: error instanceof LearningError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

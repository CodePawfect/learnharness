import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ChatRecord } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { newUserMessage, newThinkingMessage } from "../src/core/native-messages.ts";
import { applyFlashcardCommand, emptyFlashcardData, flashcardProgress, flashcardSnapshot, parseFlashcardData, selectFlashcards, type FlashcardStore } from "../src/core/flashcards.ts";
import { DAY_MS } from "../src/core/learning.ts";
import { createFlashcardStore } from "../src/store/flashcards.ts";
import { assessFlashcard, flashcardTranscript, generateFlashcards, validateFlashcardDrafts, type FlashcardDraft } from "../src/agent/flashcards.ts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-flashcards-test-"));
process.env.LH_DATA_DIR = scratch;
const { createFlashcardService, mergeFlashcards } = await import("../src/server/flashcards.ts");
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const epoch = Date.parse("2026-11-17T10:00:00.000Z");
const teacher = (id: string, text: string): LhMessage => ({ ...fauxAssistantMessage(text), id });
function record(id = "chat_tls"): ChatRecord {
	return { id, title: "TLS", createdAt: new Date(epoch).toISOString(), updatedAt: new Date(epoch).toISOString(), messages: [
		teacher("teach_tls", "TLS encrypts data in transit. Certificates authenticate the server. What does TLS protect?"),
		{ ...newUserMessage("Data in transit, with certificates checking the server."), id: "learner_tls" },
		teacher("feedback_tls", "Correct: transport encryption and server authentication, not stored data. This section is complete. Next we will study DNS."),
	] };
}
const draft = (extra: Partial<FlashcardDraft> = {}): FlashcardDraft => ({ topic: "TLS", concept: "transport protection", question: "What does TLS protect?", answer: "Data in transit; certificates authenticate the server.", criteria: "Mention transit encryption and server authentication.", teachingMessageId: "teach_tls", learnerMessageId: "learner_tls", feedbackMessageId: "feedback_tls", ...extra });
function fixture() {
	const data = emptyFlashcardData(); let n = 0;
	const newId = () => `fc_${++n}`;
	mergeFlashcards(data, record(), { cards: [draft()], deferred: true }, epoch, newId);
	const command = (body: Record<string, unknown>, now = epoch) => applyFlashcardCommand(data, body, now, newId);
	return { data, newId, command, cardId: data.cards[0]!.id, topicId: data.topics[0]!.id };
}
function memoryStore(): FlashcardStore {
	let data = emptyFlashcardData();
	return { read: () => structuredClone(data), update(change) { const next = structuredClone(data); const result = change(next); parseFlashcardData(next); data = next; return result; } };
}

describe("flashcard rounds, privacy and scheduling", () => {
	it("saves a round once, hides references until grading, rejects client grades, and resumes", () => {
		const f = fixture();
		const start = { action: "start", requestId: "request_tls", topicIds: [f.topicId], count: 1 };
		f.command(start); f.command(start);
		assert.equal(f.data.sessions.length, 1);
		let active = flashcardSnapshot(f.data, epoch).active!;
		assert.ok(!("solution" in active.attempt));
		assert.ok(!JSON.stringify(active).includes(f.data.cards[0]!.criteria));
		f.command({ action: "answer", sessionId: active.session.id, attemptId: active.attempt.id, answer: "Transport encryption", assessment: { outcome: "correct" } });
		assert.equal(f.data.attempts[0]!.assessment, undefined);
		assert.throws(() => f.command({ action: "next", sessionId: active.session.id, attemptId: active.attempt.id }), /assessment/);
		const restored = parseFlashcardData(JSON.parse(JSON.stringify(f.data)));
		assert.equal(flashcardSnapshot(restored, epoch).active!.attempt.answer, "Transport encryption");
		assert.ok(!("solution" in flashcardSnapshot(restored, epoch).active!.attempt));
		f.data.attempts[0]!.assessment = { outcome: "partial", feedback: "Also mention server authentication.", gradedAt: new Date(epoch).toISOString() };
		active = flashcardSnapshot(f.data, epoch).active!;
		assert.equal(active.attempt.solution, f.data.cards[0]!.answer);
		f.command({ action: "next", sessionId: active.session.id, attemptId: active.attempt.id });
		assert.equal(flashcardSnapshot(f.data, epoch).active, null);
		f.command(start); assert.equal(f.data.sessions.length, 1, "lost-response retry does not open a second round");
	});
	it("interleaves selected topics, prioritizes due cards globally and refuses oversized rounds", () => {
		const f = fixture();
		mergeFlashcards(f.data, record(), { cards: [draft({ topic: "Docker", concept: "image vs container", question: "Image versus container?" }), draft({ concept: "certificates", question: "Why certificates?" })], deferred: false }, epoch, f.newId);
		const topics = f.data.topics.map(t => t.id);
		const chosen = selectFlashcards(f.data, topics, 3, epoch);
		assert.equal(new Set(chosen).size, 3);
		assert.notEqual(f.data.cards.find(c => c.id === chosen[0])!.topicId, f.data.cards.find(c => c.id === chosen[1])!.topicId);
		assert.throws(() => f.command({ action: "start", requestId: "bad", topicIds: topics, count: 4 }), /1–3/);
		f.command({ action: "start", requestId: "ok", topicIds: [f.topicId], count: 1 });
		f.data.attempts[0]!.answer = "answer"; f.data.attempts[0]!.submittedAt = new Date(epoch).toISOString();
		f.data.attempts[0]!.assessment = { outcome: "correct", feedback: "Good", gradedAt: new Date(epoch).toISOString() };
		const reviewed = f.data.attempts[0]!.card.id;
		assert.equal(flashcardProgress(f.data, reviewed, epoch).due, false);
		assert.notEqual(selectFlashcards(f.data, topics, 1, epoch)[0], reviewed);
	});
	it("early practice cannot inflate intervals; corrections preserve history and reopen the card", () => {
		const f = fixture();
		f.command({ action: "start", requestId: "one", topicIds: [f.topicId], count: 1 });
		const a = f.data.attempts[0]!; a.answer = "Answer"; a.submittedAt = new Date(epoch).toISOString();
		a.assessment = { outcome: "correct", feedback: "Good", gradedAt: new Date(epoch).toISOString() };
		assert.equal(flashcardProgress(f.data, f.cardId, epoch).nextDueAt, new Date(epoch + DAY_MS).toISOString());
		f.data.attempts.push({ ...structuredClone(a), id: "extra", sessionId: a.sessionId, startedAt: new Date(epoch + 1000).toISOString(), assessment: { ...a.assessment, gradedAt: new Date(epoch + 2000).toISOString() } });
		assert.equal(flashcardProgress(f.data, f.cardId, epoch).nextDueAt, new Date(epoch + DAY_MS).toISOString());
		f.data.attempts.pop();
		mergeFlashcards(f.data, record(), { cards: [draft({ existingCardId: f.cardId, answer: "Corrected reference" })], deferred: false }, epoch + 5000, f.newId);
		assert.notEqual(a.card.answer, f.data.cards[0]!.answer);
		assert.equal(flashcardProgress(f.data, f.cardId, epoch + 5000).due, true);
	});
});

describe("source-linked generation and tutor calls", () => {
	it("accepts completed-section citations, rejects missing feedback, skipped checks and invented ids", () => {
		const r = record();
		assert.equal(validateFlashcardDrafts(r, { cards: [draft()], deferred: true }, []), null);
		assert.ok(validateFlashcardDrafts(r, { cards: [draft({ feedbackMessageId: "pending" })], deferred: false }, []));
		assert.ok(validateFlashcardDrafts(r, { cards: [draft({ feedbackMessageId: "teach_tls" })], deferred: false }, []));
		assert.ok(validateFlashcardDrafts(r, { cards: [draft({ existingCardId: "invented" })], deferred: false }, []));
	});
	it("includes practice thinking and corrections in the full transcript without exposing pending model solutions", () => {
		const r = record();
		r.messages.push(newThinkingMessage("problem_1", "I mixed up TLS and encryption at rest."));
		r.messages.push(teacher("correction", "Correction: TLS protects transport, not stored files."));
		const transcript = flashcardTranscript(r);
		assert.match(transcript, /I mixed up TLS/); assert.match(transcript, /Correction/);
		const hidden = { ...fauxAssistantMessage([fauxToolCall("problem", { statement: "Pending", modelSolution: "SECRET_PENDING_SOLUTION" })], { stopReason: "toolUse" }), id: "pending" };
		r.messages.push(hidden);
		assert.ok(!flashcardTranscript(r).includes("SECRET_PENDING_SOLUTION"));
	});
	it("uses real submit-tool validation for generation and free-text assessment with an offline model", async () => {
		const faux = createFauxCore({});
		faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_flashcards", { deferred: true, moreReady: false, cards: [{ ...draft() }] })], { stopReason: "toolUse" })]);
		const engine = { model: { ...faux.getModel(), contextWindow: 128000 }, streamFn: faux.streamSimple };
		const generated = await generateFlashcards(record(), emptyFlashcardData(), engine, AbortSignal.timeout(5000), () => {});
		assert.equal(generated.cards.length, 1);
		const f = fixture();
		faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_assessment", { outcome: "partial", feedback: "Transit encryption is right; add server authentication." })], { stopReason: "toolUse" })]);
		assert.equal((await assessFlashcard(f.data.cards[0]!, "It encrypts transport", engine, AbortSignal.timeout(5000), () => {})).outcome, "partial");
	});
});

describe("existing sessions, retries and persistent recovery", () => {
	it("backfills completed sections once, leaves unfinished sessions pending and updates after later feedback", async () => {
		const store = memoryStore(), completed = record(), pending = record("pending");
		pending.messages = pending.messages.slice(0, 2);
		const chats = [completed, pending]; let calls = 0;
		const service = createFlashcardService({ store, chats: { listChats: () => chats, getChat: id => chats.find(c => c.id === id) ?? null },
			generate: async r => { calls++; return { cards: r.messages.length >= 3 ? [draft()] : [], deferred: r.messages.length < 3 }; },
			grade: async () => ({ outcome: "correct", feedback: "Good" }) });
		service.sync(); service.sync(); await service.settled();
		assert.equal(calls, 2); assert.equal(store.read().cards.length, 1);
		assert.equal(store.read().checkpoints.find(c => c.chatId === "pending")!.deferred, true);
		service.sync(); await service.settled(); assert.equal(calls, 2);
		pending.messages.push(teacher("feedback_tls", "Correct. This section is now complete."));
		service.enqueue("pending"); await service.settled();
		assert.equal(calls, 3); assert.equal(store.read().cards.length, 1);
		assert.equal(store.read().cards[0]!.sources.length, 2);
	});
	it("does not checkpoint failures, retries safely and keeps saved answers after a failed assessment", async () => {
		const store = memoryStore(); let failGeneration = true, failGrade = true, gradeCalls = 0;
		const r = record();
		const service = createFlashcardService({ store, chats: { listChats: () => [r], getChat: () => r },
			generate: async () => { if (failGeneration) throw new Error("Disconnected"); return { cards: [draft()], deferred: false }; },
			grade: async () => { gradeCalls++; if (failGrade) throw new Error("Disconnected"); return { outcome: "correct", feedback: "Good" }; } });
		service.sync(); await service.settled(); assert.equal(store.read().checkpoints.length, 0);
		failGeneration = false; service.sync(true); await service.settled();
		await service.command({ action: "start", requestId: "round", topicIds: store.read().topics.map(t => t.id), count: 1 });
		const active = service.snapshot().active!;
		const submit = { action: "answer", sessionId: active.session.id, attemptId: active.attempt.id, answer: "Full answer" };
		await assert.rejects(service.command(submit), /answer is saved/);
		assert.equal(service.snapshot().active!.attempt.answer, "Full answer");
		assert.ok(!("solution" in service.snapshot().active!.attempt));
		failGrade = false; await Promise.all([service.command(submit), service.command(submit)]);
		assert.equal(gradeCalls, 2, "concurrent retries share one grading call");
		assert.equal(store.read().attempts.length, 1);
	});
	it("checks every generated page before marking a session processed", async () => {
		const store = memoryStore(), r = record(); let page = 0;
		const service = createFlashcardService({ store, chats: { listChats: () => [r], getChat: () => r },
			generate: async () => { page++; return { cards: [draft(page === 1 ? {} : { concept: "certificate role", question: "Why certificates?" })], moreReady: page === 1, deferred: false }; },
			grade: async () => ({ outcome: "correct", feedback: "Good" }) });
		service.sync(); await service.settled(); assert.equal(page, 2); assert.equal(store.read().cards.length, 2); assert.equal(store.read().checkpoints.length, 1);
	});
	it("discards stale generation if a newer turn corrected the session", async () => {
		const store = memoryStore(), r = record(); let calls = 0;
		const service = createFlashcardService({ store, chats: { listChats: () => [r], getChat: () => r },
			generate: async () => { calls++; if (calls === 1) r.messages.push(teacher("late", "Correct the earlier explanation.")); return { cards: [draft({ answer: calls === 1 ? "STALE" : "Corrected" })], deferred: false }; },
			grade: async () => ({ outcome: "correct", feedback: "Good" }) });
		service.sync(); await service.settled(); assert.equal(calls, 2); assert.equal(store.read().cards[0]!.answer, "Corrected");
	});
	it("persists across reopening, isolates failed writes and preserves corrupt/future files", () => {
		const directory = fs.mkdtempSync(path.join(scratch, "store-"));
		const store = createFlashcardStore(directory); let n = 0;
		store.update(data => mergeFlashcards(data, record(), { cards: [draft()], deferred: true }, epoch, () => `persist_${++n}`));
		assert.equal(createFlashcardStore(directory).read().cards.length, 1);
		const file = path.join(directory, "flashcards.json"), original = fs.readFileSync(file, "utf8");
		assert.throws(() => store.update(d => { d.cards[0]!.topicId = "missing"; }));
		assert.equal(fs.readFileSync(file, "utf8"), original);
		fs.writeFileSync(path.join(directory, "flashcards.lock"), "other process");
		assert.throws(() => store.update(() => {}), /busy/); fs.unlinkSync(path.join(directory, "flashcards.lock"));
		fs.writeFileSync(file, '{"version":99}'); assert.throws(() => store.read(), /preserved/); assert.equal(fs.readFileSync(file, "utf8"), '{"version":99}');
	});
});

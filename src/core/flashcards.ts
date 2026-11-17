import { DAY_MS, REVIEW_INTERVAL_DAYS, LearningError, learningObject, learningText } from "./learning.ts";

export type FlashcardOutcome = "correct" | "partial" | "incorrect";
export interface FlashcardTopic { id: string; name: string; createdAt: string }
export interface FlashcardSource { chatId: string; messageIds: string[] }
export interface Flashcard {
	id: string; topicId: string; concept: string; question: string; answer: string; criteria: string;
	sources: FlashcardSource[]; createdAt: string; updatedAt: string;
}
export interface FlashcardAssessment { outcome: FlashcardOutcome; feedback: string; gradedAt: string }
export interface FlashcardAttempt {
	id: string; sessionId: string; card: Flashcard; startedAt: string;
	answer?: string; submittedAt?: string; assessment?: FlashcardAssessment;
}
export interface FlashcardSession {
	id: string; requestId: string; topicIds: string[]; cardIds: string[]; index: number; startedAt: string; endedAt?: string;
}
export interface FlashcardCheckpoint { chatId: string; fingerprint: string; checkedAt: string; deferred: boolean }
export interface FlashcardData {
	version: 1; topics: FlashcardTopic[]; cards: Flashcard[]; attempts: FlashcardAttempt[];
	sessions: FlashcardSession[]; checkpoints: FlashcardCheckpoint[];
}
export interface FlashcardStore { read(): FlashcardData; update<T>(change: (data: FlashcardData) => T): T }
export function emptyFlashcardData(): FlashcardData {
	return { version: 1, topics: [], cards: [], attempts: [], sessions: [], checkpoints: [] };
}
export function flashcardIdentity(text: string): string { return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en"); }
export function parseAssessment(raw: unknown): Pick<FlashcardAssessment, "outcome" | "feedback"> {
	const b = learningObject(raw);
	if (!["correct", "partial", "incorrect"].includes(b.outcome as string)) throw new LearningError("Invalid tutor assessment.");
	return { outcome: b.outcome as FlashcardOutcome, feedback: learningText(b.feedback, "Feedback", 8000) };
}

/** Scheduling is per card. Model assessments never enter the independently checked Review evidence. */
export function flashcardProgress(data: FlashcardData, cardId: string, now: number) {
	const card = data.cards.find(c => c.id === cardId);
	let due = card ? Date.parse(card.createdAt) : now, stage = 0;
	const attempts = data.attempts.filter(a => a.card.id === cardId && a.assessment)
		.sort((a, b) => a.assessment!.gradedAt.localeCompare(b.assessment!.gradedAt));
	for (const a of attempts) {
		// A corrected reference needs a fresh retrieval; historical grades keep their old key.
		if (card && (a.card.answer !== card.answer || a.card.criteria !== card.criteria)) { due = Date.parse(card.updatedAt); stage = 0; continue; }
		const at = Date.parse(a.assessment!.gradedAt);
		if (a.assessment!.outcome === "correct") {
			if (Date.parse(a.startedAt) >= due) {
				due = at + REVIEW_INTERVAL_DAYS[Math.min(stage, REVIEW_INTERVAL_DAYS.length - 1)]! * DAY_MS;
				stage = Math.min(stage + 1, REVIEW_INTERVAL_DAYS.length - 1);
			}
		} else { stage = 0; due = due > at ? Math.min(due, at + DAY_MS) : at + DAY_MS; }
	}
	const last = attempts.at(-1)?.assessment;
	return { due: due <= now, nextDueAt: new Date(due).toISOString(), reviews: attempts.length, lastOutcome: last?.outcome };
}

/** Sort within topics, then round-robin the topics; no card appears twice. */
export function selectFlashcards(data: FlashcardData, topicIds: string[], count: number, now: number): string[] {
	const pools = topicIds.map(id => data.cards.filter(c => c.topicId === id).map(c => ({ c, p: flashcardProgress(data, c.id, now) }))
		.sort((a, b) => Number(b.p.due) - Number(a.p.due) ||
			Number(b.p.lastOutcome === "incorrect" || b.p.lastOutcome === "partial") - Number(a.p.lastOutcome === "incorrect" || a.p.lastOutcome === "partial") ||
			a.p.nextDueAt.localeCompare(b.p.nextDueAt) || a.c.id.localeCompare(b.c.id)));
	const result: string[] = [];
	while (result.length < count && pools.some(p => p.length)) {
		const hasDue = pools.some(p => p[0]?.p.due);
		for (const pool of pools) {
			if (hasDue && !pool[0]?.p.due) continue;
			const item = pool.shift(); if (item) result.push(item.c.id);
			if (result.length === count) break;
		}
	}
	return result;
}

export function activeFlashcardSession(data: FlashcardData): FlashcardSession | undefined { return data.sessions.find(s => !s.endedAt); }
export function currentFlashcardAttempt(data: FlashcardData): FlashcardAttempt | undefined {
	const session = activeFlashcardSession(data);
	return session ? data.attempts.find(a => a.sessionId === session.id && a.card.id === session.cardIds[session.index]) : undefined;
}
function publicCard(card: Flashcard) {
	return { id: card.id, topicId: card.topicId, question: card.question, sources: card.sources, createdAt: card.createdAt };
}
export function flashcardSnapshot(data: FlashcardData, now: number) {
	const session = activeFlashcardSession(data), attempt = currentFlashcardAttempt(data);
	return {
		topics: data.topics.map(t => ({ ...t, count: data.cards.filter(c => c.topicId === t.id).length,
			dueCount: data.cards.filter(c => c.topicId === t.id && flashcardProgress(data, c.id, now).due).length })),
		cards: data.cards.map(c => ({ ...publicCard(c), progress: flashcardProgress(data, c.id, now) })),
		active: session && attempt ? { session, attempt: { id: attempt.id, card: publicCard(attempt.card), answer: attempt.answer,
			submittedAt: attempt.submittedAt, assessment: attempt.assessment,
			...(attempt.assessment ? { solution: attempt.card.answer, criteria: attempt.card.criteria } : {}) } } : null,
		lastSession: !session && data.sessions.length ? (() => {
			const last = data.sessions.at(-1)!;
			return { total: last.cardIds.length, completed: data.attempts.filter(a => a.sessionId === last.id && a.assessment).length, endedAt: last.endedAt,
				correct: data.attempts.filter(a => a.sessionId === last.id && a.assessment?.outcome === "correct").length };
		})() : null,
		checkedSessions: data.checkpoints.length, deferredSessions: data.checkpoints.filter(c => c.deferred).length,
	};
}
export type FlashcardSnapshot = ReturnType<typeof flashcardSnapshot>;

/** Browser commands contain no trusted grades or answer keys. */
export function applyFlashcardCommand(data: FlashcardData, raw: unknown, now: number, newId: () => string): void {
	const b = learningObject(raw), at = new Date(now).toISOString();
	const session = activeFlashcardSession(data);
	const openAttempt = (s: FlashcardSession) => {
		const card = data.cards.find(c => c.id === s.cardIds[s.index]);
		if (!card) throw new LearningError("This flashcard is unavailable.", 409);
		data.attempts.push({ id: newId(), sessionId: s.id, card: structuredClone(card), startedAt: at });
	};
	if (b.action === "start") {
		const requestId = learningText(b.requestId, "Request id", 160);
		if (!/^[\w-]{1,160}$/.test(requestId)) throw new LearningError("Invalid request id.");
		if (session || data.sessions.some(s => s.requestId === requestId)) return;
		if (!Array.isArray(b.topicIds) || !b.topicIds.length || b.topicIds.some(id => typeof id !== "string" || !data.topics.some(t => t.id === id))) throw new LearningError("Choose at least one available topic.");
		const ids = [...new Set(b.topicIds as string[])];
		const available = data.cards.filter(c => ids.includes(c.topicId)).length;
		if (typeof b.count !== "number" || !Number.isInteger(b.count) || b.count < 1 || b.count > available) throw new LearningError(`Choose 1–${available} cards in total.`);
		const next: FlashcardSession = { id: newId(), requestId, topicIds: ids, cardIds: selectFlashcards(data, ids, b.count, now), index: 0, startedAt: at };
		data.sessions.push(next); openAttempt(next); return;
	}
	if (!session || b.sessionId !== session.id) throw new LearningError("This learning round is no longer active. Reload to continue.", 409);
	if (b.action === "end") { session.endedAt = at; return; }
	const attempt = currentFlashcardAttempt(data);
	if (!attempt || b.attemptId !== attempt.id) throw new LearningError("This card is no longer current. Reload to continue.", 409);
	if (b.action === "answer") {
		const answer = learningText(b.answer, "Your answer", 16000);
		if (attempt.answer !== undefined && attempt.answer !== answer) throw new LearningError("This answer is already saved. Continue with its assessment.", 409);
		attempt.answer = answer; attempt.submittedAt ??= at; return;
	}
	if (b.action === "next") {
		if (!attempt.assessment) throw new LearningError("Wait for the tutor assessment before continuing.", 409);
		session.index++;
		if (session.index === session.cardIds.length) session.endedAt = at;
		else openAttempt(session);
		return;
	}
	throw new LearningError("Unknown flashcard action.");
}

/** Validate on read AND before atomic writes. Preserve corrupt/future files. */
export function parseFlashcardData(raw: unknown): FlashcardData {
	const d = learningObject(raw);
	if (d.version !== 1) throw new LearningError("Unsupported flashcard data version.", 500);
	for (const key of ["topics", "cards", "attempts", "sessions", "checkpoints"] as const) if (!Array.isArray(d[key])) throw new LearningError(`Invalid flashcard ${key}.`, 500);
	const id = (v: unknown) => { if (typeof v !== "string" || !/^[\w-]{1,160}$/.test(v)) throw new LearningError("Invalid flashcard id.", 500); };
	const date = (v: unknown) => { if (typeof v !== "string" || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) throw new LearningError("Invalid flashcard date.", 500); };
	const ids = (v: unknown) => { if (!Array.isArray(v) || !v.length || new Set(v).size !== v.length) throw new LearningError("Invalid flashcard references.", 500); v.forEach(id); };
	const card = (raw: unknown) => {
		const c = learningObject(raw); id(c.id); id(c.topicId); date(c.createdAt); date(c.updatedAt);
		for (const k of ["concept", "question", "answer", "criteria"]) learningText(c[k], k, 8000);
		if (!Array.isArray(c.sources) || !c.sources.length) throw new LearningError("Missing flashcard sources.", 500);
		for (const raw of c.sources) { const s = learningObject(raw); id(s.chatId); ids(s.messageIds); }
	};
	for (const raw of d.topics as unknown[]) { const t = learningObject(raw); id(t.id); learningText(t.name, "Topic", 160); date(t.createdAt); }
	for (const c of d.cards as unknown[]) card(c);
	for (const raw of d.sessions as unknown[]) {
		const s = learningObject(raw); id(s.id); id(s.requestId); ids(s.topicIds); ids(s.cardIds); date(s.startedAt); if (s.endedAt) date(s.endedAt);
		if (!Number.isInteger(s.index) || (s.index as number) < 0 || (s.index as number) > (s.cardIds as unknown[]).length || (!(s.endedAt) && s.index === (s.cardIds as unknown[]).length)) throw new LearningError("Invalid flashcard round position.", 500);
	}
	for (const raw of d.attempts as unknown[]) {
		const a = learningObject(raw); id(a.id); id(a.sessionId); date(a.startedAt); card(a.card);
		if (a.answer !== undefined) { learningText(a.answer, "Saved answer", 16000); date(a.submittedAt); }
		if (a.assessment) { if (!a.answer) throw new LearningError("Assessment without answer.", 500); parseAssessment(a.assessment); date(learningObject(a.assessment).gradedAt); }
	}
	for (const raw of d.checkpoints as unknown[]) { const c = learningObject(raw); id(c.chatId); learningText(c.fingerprint, "Fingerprint", 160); date(c.checkedAt); if (typeof c.deferred !== "boolean") throw new LearningError("Invalid deferred flag.", 500); }
	const data = d as unknown as FlashcardData;
	for (const key of ["topics", "cards", "sessions", "attempts"] as const) if (new Set(data[key].map(r => r.id)).size !== data[key].length) throw new LearningError("Duplicate flashcard ids.", 500);
	if (new Set(data.checkpoints.map(c => c.chatId)).size !== data.checkpoints.length || data.sessions.filter(s => !s.endedAt).length > 1 ||
		data.cards.some(c => !data.topics.some(t => t.id === c.topicId)) ||
		data.sessions.some(s => s.topicIds.some(id => !data.topics.some(t => t.id === id)) || s.cardIds.some(id => !data.cards.some(c => c.id === id))) ||
		data.attempts.some(a => !data.sessions.some(s => s.id === a.sessionId && s.cardIds.includes(a.card.id)) || !data.cards.some(c => c.id === a.card.id))) throw new LearningError("Broken flashcard references.", 500);
	const active = activeFlashcardSession(data);
	if (active && !currentFlashcardAttempt(data)) throw new LearningError("Missing current flashcard attempt.", 500);
	if (new Set(data.attempts.map(a => `${a.sessionId}:${a.card.id}`)).size !== data.attempts.length) throw new LearningError("Duplicate flashcard attempt.", 500);
	return data;
}

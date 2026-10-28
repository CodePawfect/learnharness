/** Learning evidence is separate from the content graph. All dates and outcomes
 * are committed by the server; no model can certify its own answer key. */
export const LEARNING_VERSION = 1;
export const DAY_MS = 86_400_000;
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60] as const;
export const TEACHING_STYLES = ["adaptive", "worked-examples", "socratic", "project", "concise"] as const;
export type TeachingStyle = typeof TEACHING_STYLES[number];
export type StudyCondition = "harness" | "ordinary-chat" | "course";
export type CheckKind = "recall" | "transfer";
export type AnswerMode = "exact" | "numeric" | "rubric";

export interface LearningGoal {
	id: string;
	requestId?: string;
	title: string;
	objective: string;
	conceptIds: string[];
	createdAt: string;
	archived: boolean;
	condition: StudyCondition;
	sourceChatId?: string;
}

export interface LearningCheck {
	id: string;
	requestId?: string;
	goalId: string;
	prompt: string;
	kind: CheckKind;
	answerMode: AnswerMode;
	/** Exact answers are compared after whitespace normalization, case-sensitive.
	 * Numeric answers are finite decimal/scientific numbers with absolute tolerance.
	 * Rubric answers are self-assessed, never counted as verified mastery. */
	answer: string;
	tolerance: number;
	source: string;
	sourceUrl?: string;
	createdAt: string;
	author: "learner" | "tutor";
	keyReviewedAt?: string;
	retired: boolean;
}

export interface LearningAttempt {
	id: string;
	goalId: string;
	checkId: string;
	startedAt: string;
	/** Immutable copy: retiring or replacing a check cannot rewrite evidence. */
	check: LearningCheck;
	condition: StudyCondition;
	submittedAt?: string;
	answer?: string;
	confidence?: number;
	assisted: boolean;
	revealedAt?: string;
	outcome?: "correct" | "partial" | "incorrect";
	grading?: "answer-key" | "self";
	cancelledAt?: string;
}

export interface LearningObservation {
	id: string;
	goalId: string;
	chatId: string;
	messageId: string;
	quote: string;
	note: string;
	judgment: "progress" | "gap" | "misconception";
	at: string;
}

export interface LearningData {
	version: 1;
	goals: LearningGoal[];
	checks: LearningCheck[];
	attempts: LearningAttempt[];
	observations: LearningObservation[];
	preferences: { style: TeachingStyle; sessionMinutes: number };
}

export interface LearningStore {
	read(): LearningData;
	/** Synchronous atomic read-modify-write, with a lock across processes. */
	update<T>(change: (data: LearningData) => T): T;
}

export function emptyLearningData(): LearningData {
	return { version: 1, goals: [], checks: [], attempts: [], observations: [], preferences: { style: "adaptive", sessionMinutes: 20 } };
}

export class LearningError extends Error {
	constructor(message: string, public status = 400) { super(message); this.name = "LearningError"; }
}

export function learningText(value: unknown, label: string, max = 4000): string {
	if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
		throw new LearningError(`${label} must contain 1–${max} characters.`);
	}
	return value.trim();
}

export function learningObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new LearningError("Expected an object.");
	return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
	if (typeof value !== "string" || !options.includes(value as T)) throw new LearningError(`Invalid ${label}.`);
	return value as T;
}

export function parseGoalInput(value: unknown): Pick<LearningGoal, "title" | "objective" | "conceptIds" | "condition"> {
	const b = learningObject(value);
	const conceptIds = b.conceptIds ?? [];
	if (!Array.isArray(conceptIds) || conceptIds.length > 32 || conceptIds.some(id => typeof id !== "string" || !/^[\w-]{1,160}$/.test(id))) {
		throw new LearningError("Choose up to 32 valid concepts.");
	}
	return {
		title: learningText(b.title, "Title", 160), objective: learningText(b.objective, "Objective", 2000),
		conceptIds: [...new Set(conceptIds as string[])],
		condition: oneOf(b.condition ?? "harness", ["harness", "ordinary-chat", "course"], "study condition"),
	};
}

export function parseCheckInput(value: unknown): Pick<LearningCheck, "prompt" | "kind" | "answerMode" | "answer" | "tolerance" | "source" | "sourceUrl"> {
	const b = learningObject(value);
	const answerMode = oneOf(b.answerMode, ["exact", "numeric", "rubric"], "answer mode");
	const answer = learningText(b.answer, "Answer or rubric", 8000);
	const tolerance = b.tolerance ?? 0;
	if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) throw new LearningError("Tolerance must be a finite non-negative number.");
	if (answerMode === "numeric" && parseNumericAnswer(answer) === null) throw new LearningError("The answer must be a finite number, without units.");
	let sourceUrl: string | undefined;
	if (b.sourceUrl !== undefined && b.sourceUrl !== "") {
		sourceUrl = learningText(b.sourceUrl, "Source URL", 2000);
		let url: URL;
		try { url = new URL(sourceUrl); } catch { throw new LearningError("Source URL must be a complete HTTP(S) URL."); }
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new LearningError("Use an HTTP(S) source URL without credentials.");
	}
	return {
		prompt: learningText(b.prompt, "Question", 8000), kind: oneOf(b.kind, ["recall", "transfer"], "check kind"),
		answerMode, answer, tolerance, source: learningText(b.source, "Source and location", 2000),
		...(sourceUrl ? { sourceUrl } : {}),
	};
}

export function parseLearningPreferences(value: unknown): LearningData["preferences"] {
	const b = learningObject(value);
	const style = oneOf(b.style, TEACHING_STYLES, "teaching style");
	if (typeof b.sessionMinutes !== "number" || !Number.isInteger(b.sessionMinutes) || b.sessionMinutes < 5 || b.sessionMinutes > 120) {
		throw new LearningError("Session length must be 5–120 whole minutes.");
	}
	return { style, sessionMinutes: b.sessionMinutes };
}

export function parseNumericAnswer(value: string): number | null {
	const text = value.trim();
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
	const n = Number(text);
	return Number.isFinite(n) ? n : null;
}

export function gradeLearningAnswer(check: LearningCheck, answer: string): "correct" | "incorrect" | undefined {
	if (check.answerMode === "rubric") return undefined;
	if (check.answerMode === "exact") {
		const normalize = (s: string) => s.trim().replace(/\s+/g, " ");
		return normalize(answer) === normalize(check.answer) ? "correct" : "incorrect";
	}
	const actual = parseNumericAnswer(answer), expected = parseNumericAnswer(check.answer);
	if (actual === null || expected === null) return "incorrect";
	const error = Math.abs(actual - expected);
	// A few ULPs only at the tolerance boundary, never an implicit loose tolerance.
	return error <= check.tolerance || (check.tolerance > 0 && error - check.tolerance <= Number.EPSILON * Math.max(Math.abs(actual), Math.abs(expected), 1) * 4)
		? "correct" : "incorrect";
}

export function isIndependentEvidence(attempt: LearningAttempt): boolean {
	return Boolean(attempt.submittedAt && !attempt.cancelledAt && attempt.outcome === "correct" &&
		!attempt.assisted && !attempt.revealedAt && attempt.grading === "answer-key" && attempt.check.keyReviewedAt &&
		Date.parse(attempt.check.keyReviewedAt) <= Date.parse(attempt.startedAt));
}

export interface LearningProgress {
	state: "not-assessed" | "practiced" | "demonstrated" | "retained";
	nextDueAt: string;
	due: boolean;
	intervalDays: number;
	attempts: number;
	independentPasses: number;
	lastReviewedAt?: string;
}

/** Transparent, deliberately conservative interval heuristic, not a calibrated
 * forgetting model. Early practice cannot push the scheduled review away. */
export function learningProgress(goal: LearningGoal, data: LearningData, now: number): LearningProgress {
	const attempts = data.attempts.filter(a => a.goalId === goal.id && a.submittedAt && a.outcome && !a.cancelledAt)
		.sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!));
	let due = Date.parse(goal.createdAt), stage = 0, intervalDays = 0;
	let window: LearningAttempt[] = [];
	for (const a of attempts) {
		const at = Date.parse(a.submittedAt!);
		if (isIndependentEvidence(a)) {
			window.push(a);
			if (Date.parse(a.startedAt) >= due) {
				intervalDays = REVIEW_INTERVAL_DAYS[Math.min(stage, REVIEW_INTERVAL_DAYS.length - 1)]!;
				due = at + intervalDays * DAY_MS;
				stage = Math.min(stage + 1, REVIEW_INTERVAL_DAYS.length - 1);
			}
		} else {
			// Assistance, a miss, or self-assessment cannot certify independence.
			window = [];
			stage = 0;
			intervalDays = 1;
			due = due > at ? Math.min(due, at + DAY_MS) : at + DAY_MS;
		}
	}
	let state: LearningProgress["state"] = attempts.length || data.observations.some(o => o.goalId === goal.id) ? "practiced" : "not-assessed";
	// Require distinct tasks, a delayed retrieval, and independent application.
	const first = window[0];
	const transfer = window.find(a => a.check.kind === "transfer" && first && a.checkId !== first.checkId &&
		Date.parse(a.startedAt) - Date.parse(first.submittedAt!) >= DAY_MS);
	if (transfer) state = "demonstrated";
	if (transfer && first && window.some(a => Date.parse(a.startedAt) - Date.parse(first.submittedAt!) >= 7 * DAY_MS)) state = "retained";
	return {
		state, nextDueAt: new Date(due).toISOString(), due: !goal.archived && due <= now, intervalDays,
		attempts: attempts.length, independentPasses: attempts.filter(isIndependentEvidence).length,
		...(attempts.length ? { lastReviewedAt: attempts.at(-1)!.submittedAt } : {}),
	};
}

/** Favor the least-used item, alternate recall/application on ties. The queue
 * interleaves goals and never invents a question when the bank is empty. */
export function selectReviewCheck(data: LearningData, goalId?: string): LearningCheck | undefined {
	const last = data.attempts.filter(a => !a.cancelledAt).at(-1);
	return data.checks.filter(c => !c.retired && c.keyReviewedAt && (!goalId || c.goalId === goalId) &&
		data.goals.some(g => g.id === c.goalId && !g.archived))
		.sort((a, b) => {
			const attemptsA = data.attempts.filter(x => x.checkId === a.id && !x.cancelledAt).length;
			const attemptsB = data.attempts.filter(x => x.checkId === b.id && !x.cancelledAt).length;
			return attemptsA - attemptsB || Number(a.kind === last?.check.kind) - Number(b.kind === last?.check.kind) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
		})[0];
}

export function selectDueGoal(data: LearningData, now: number): LearningGoal | undefined {
	const last = data.attempts.filter(a => !a.cancelledAt).at(-1);
	return data.goals.filter(g => !g.archived && learningProgress(g, data, now).due && selectReviewCheck(data, g.id))
		.sort((a, b) => Number(a.id === last?.goalId) - Number(b.id === last?.goalId) ||
			learningProgress(a, data, now).nextDueAt.localeCompare(learningProgress(b, data, now).nextDueAt) || a.id.localeCompare(b.id))[0];
}

export type PublicCheck = Omit<LearningCheck, "answer" | "tolerance">;
export type PublicAttempt = Omit<LearningAttempt, "check"> & { check: PublicCheck; solution?: Pick<LearningCheck, "answer" | "tolerance"> };
export interface LearningSnapshot {
	goals: Array<LearningGoal & { progress: LearningProgress }>;
	checks: PublicCheck[];
	attempts: PublicAttempt[];
	observations: LearningObservation[];
	preferences: LearningData["preferences"];
	dueCount: number;
	active?: PublicAttempt;
	generatedAt: string;
}

export function publicLearningCheck(check: LearningCheck): PublicCheck {
	const { answer: _answer, tolerance: _tolerance, ...publicCheck } = check;
	return publicCheck;
}

export function publicLearningAttempt(attempt: LearningAttempt): PublicAttempt {
	return { ...attempt, check: publicLearningCheck(attempt.check),
		...((attempt.submittedAt || attempt.revealedAt || attempt.cancelledAt) ? { solution: { answer: attempt.check.answer, tolerance: attempt.check.tolerance } } : {}) };
}

export function pendingLearningAttempt(data: LearningData): LearningAttempt | undefined {
	return data.attempts.find(a => !a.cancelledAt && (!a.submittedAt || (a.grading === "self" && !a.outcome)));
}

export function learningSnapshot(data: LearningData, now: number): LearningSnapshot {
	const goals = data.goals.map(g => ({ ...g, progress: learningProgress(g, data, now) }));
	const active = pendingLearningAttempt(data);
	return {
		goals, checks: data.checks.map(publicLearningCheck), attempts: data.attempts.map(a => {
			const view = publicLearningAttempt(a);
			if (active && !active.submittedAt && !active.revealedAt && a.id !== active.id) delete view.solution;
			return view;
		}),
		observations: data.observations, preferences: data.preferences,
		dueCount: goals.filter(g => g.progress.due && selectReviewCheck(data, g.id)).length,
		...(active ? { active: publicLearningAttempt(active) } : {}), generatedAt: new Date(now).toISOString(),
	};
}

/** A reproducible descriptive report. Never infer causal effectiveness from
 * self-selected subjects/conditions or mix self ratings with checked answers. */
export function evaluateLearning(data: LearningData) {
	return (["harness", "ordinary-chat", "course"] as const).map(condition => {
		const attempts = data.attempts.filter(a => a.condition === condition && a.submittedAt && a.outcome && !a.cancelledAt);
		const delayed = attempts.filter(a => {
			const first = data.attempts.filter(x => x.goalId === a.goalId && x.submittedAt && !x.cancelledAt)
				.sort((x, y) => x.submittedAt!.localeCompare(y.submittedAt!))[0];
			return a.check.kind === "transfer" && a.grading === "answer-key" && a.check.keyReviewedAt &&
				first && first.checkId !== a.checkId && Date.parse(a.startedAt) - Date.parse(first.submittedAt!) >= 7 * DAY_MS;
		});
		const successes = delayed.filter(isIndependentEvidence).length;
		return {
			condition, goals: data.goals.filter(g => g.condition === condition).length, attempts: attempts.length,
			delayedTransferAttempts: delayed.length, unaidedDelayedTransferPasses: successes,
			unaidedDelayedTransferRate: delayed.length ? successes / delayed.length : null,
			selfAssessedAttempts: attempts.filter(a => a.grading === "self").length,
			elapsedReviewMinutes: attempts.reduce((sum, a) => sum + Math.max(0, Date.parse(a.submittedAt!) - Date.parse(a.startedAt)), 0) / 60_000,
		};
	});
}

/** Fail closed on malformed/newer files instead of resetting learning history. */
export function parseLearningData(raw: unknown): LearningData {
	const d = learningObject(raw);
	if (d.version !== LEARNING_VERSION) throw new LearningError("Unsupported learning-data version; keep the original file and use a compatible build.", 500);
	for (const key of ["goals", "checks", "attempts", "observations"] as const) {
		if (!Array.isArray(d[key])) throw new LearningError(`Invalid learning ${key}.`, 500);
	}
	const id = (v: unknown) => { if (typeof v !== "string" || !/^[\w-]{1,160}$/.test(v)) throw new LearningError("Invalid learning record id.", 500); };
	const date = (v: unknown) => { if (typeof v !== "string" || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) throw new LearningError("Invalid learning date.", 500); };
	const bool = (v: unknown) => { if (typeof v !== "boolean") throw new LearningError("Invalid learning flag.", 500); };
	const check = (v: unknown) => {
		const c = learningObject(v); id(c.id); id(c.goalId); date(c.createdAt); bool(c.retired);
		if (c.requestId !== undefined) id(c.requestId);
		parseCheckInput(c); oneOf(c.author, ["learner", "tutor"], "check author");
		if (c.keyReviewedAt !== undefined) date(c.keyReviewedAt);
	};
	for (const v of d.goals as unknown[]) {
		const g = learningObject(v); id(g.id); date(g.createdAt); bool(g.archived); parseGoalInput(g);
		if (g.requestId !== undefined) id(g.requestId);
		if (g.sourceChatId !== undefined) id(g.sourceChatId);
	}
	for (const v of d.checks as unknown[]) check(v);
	for (const v of d.attempts as unknown[]) {
		const a = learningObject(v); id(a.id); id(a.goalId); id(a.checkId); date(a.startedAt); bool(a.assisted); check(a.check);
		oneOf(a.condition, ["harness", "ordinary-chat", "course"], "study condition");
		for (const key of ["submittedAt", "cancelledAt", "revealedAt"]) if (a[key] !== undefined) date(a[key]);
		if (a.confidence !== undefined && (typeof a.confidence !== "number" || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 100)) throw new LearningError("Invalid saved confidence.", 500);
		if (a.submittedAt) {
			learningText(a.answer, "Saved answer", 16000);
			if (a.outcome !== undefined) oneOf(a.outcome, ["correct", "partial", "incorrect"], "outcome");
			oneOf(a.grading, ["self", "answer-key"], "grading");
			if (a.grading === "answer-key" && !["correct", "incorrect"].includes(a.outcome as string)) throw new LearningError("Invalid checked outcome.", 500);
			if (Date.parse(a.submittedAt as string) < Date.parse(a.startedAt as string)) throw new LearningError("Answer timestamp precedes the attempt.", 500);
		}
	}
	for (const v of d.observations as unknown[]) {
		const o = learningObject(v); id(o.id); id(o.goalId); id(o.chatId); id(o.messageId); date(o.at);
		learningText(o.quote, "Evidence quote"); learningText(o.note, "Evidence note");
		oneOf(o.judgment, ["progress", "gap", "misconception"], "observation");
	}
	parseLearningPreferences(d.preferences);
	const goals = d.goals as LearningGoal[], checks = d.checks as LearningCheck[], attempts = d.attempts as LearningAttempt[];
	const goalIds = new Set(goals.map(g => g.id)), checkIds = new Set(checks.map(c => c.id));
	if (checks.some(c => !goalIds.has(c.goalId)) || attempts.some(a => !goalIds.has(a.goalId) || !checkIds.has(a.checkId) || a.checkId !== a.check.id || a.goalId !== a.check.goalId) ||
		(d.observations as LearningObservation[]).some(o => !goalIds.has(o.goalId))) throw new LearningError("Learning evidence has a broken reference.", 500);
	if (attempts.filter(a => !a.cancelledAt && (!a.submittedAt || (a.grading === "self" && !a.outcome))).length > 1) throw new LearningError("Multiple active learning reviews.", 500);
	for (const key of ["goals", "checks", "attempts", "observations"] as const) {
		const rows = d[key] as Array<{ id: string }>;
		if (new Set(rows.map(r => r.id)).size !== rows.length) throw new LearningError(`Duplicate learning ${key} ids.`, 500);
	}
	return d as unknown as LearningData;
}

/** Browser-only commands. Agent tools expose a smaller surface and cannot
 * approve keys, submit answers, self-grade, or manufacture independent evidence. */
export function applyLearningCommand(data: LearningData, raw: unknown, now: number, newId: () => string): unknown {
	const b = learningObject(raw), at = new Date(now).toISOString();
	const requestId = b.requestId;
	if (requestId !== undefined && (typeof requestId !== "string" || !/^[\w-]{1,160}$/.test(requestId))) throw new LearningError("Invalid request id.");
	const goal = () => {
		const g = data.goals.find(g => g.id === b.goalId);
		if (!g) throw new LearningError("Learning goal not found.", 404);
		return g;
	};
	const check = () => {
		const c = data.checks.find(c => c.id === b.checkId);
		if (!c) throw new LearningError("Review question not found.", 404);
		return c;
	};
	const attempt = () => {
		const a = data.attempts.find(a => a.id === b.attemptId);
		if (!a) throw new LearningError("Review attempt not found.", 404);
		return a;
	};
	const active = () => pendingLearningAttempt(data);
	const assertIdle = () => { if (active()) throw new LearningError("Finish or end the active review first.", 409); };
	switch (b.action) {
		case "create_goal": {
			const input = parseGoalInput(b);
			const existing = requestId ? data.goals.find(g => g.requestId === requestId) : undefined;
			if (existing) {
				if (JSON.stringify(parseGoalInput(existing)) !== JSON.stringify(input)) throw new LearningError("This request id was already used with different goal data.", 409);
				return { goalId: existing.id };
			}
			const g: LearningGoal = { ...input, id: newId(), createdAt: at, archived: false, ...(requestId ? { requestId } : {}) };
			data.goals.push(g); return { goalId: g.id };
		}
		case "archive_goal": {
			assertIdle(); const g = goal();
			if (typeof b.archived !== "boolean") throw new LearningError("Archived must be true or false.");
			g.archived = b.archived; return { goalId: g.id };
		}
		case "add_check": {
			assertIdle(); const g = goal();
			if (g.archived) throw new LearningError("Restore the learning goal before adding questions.");
			const input = parseCheckInput(b), existing = requestId ? data.checks.find(c => c.requestId === requestId) : undefined;
			if (existing) {
				if (existing.goalId !== g.id || JSON.stringify(parseCheckInput(existing)) !== JSON.stringify(input)) throw new LearningError("This request id was already used with different question data.", 409);
				return { checkId: existing.id };
			}
			const c: LearningCheck = { ...input, id: newId(), goalId: g.id, author: "learner", createdAt: at, retired: false, ...(requestId ? { requestId } : {}) };
			data.checks.push(c); return { checkId: c.id };
		}
		case "inspect_key": {
			const c = check();
			// Inspecting the bank, even in another tab, makes an active review assisted.
			const a = active(); if (a) { a.assisted = true; a.revealedAt ??= at; }
			return c;
		}
		case "approve_key": {
			assertIdle(); const c = check();
			if (c.retired) throw new LearningError("This question has been retired.");
			if (b.confirmed !== true) throw new LearningError("Confirm that you checked the answer and source.");
			c.keyReviewedAt ??= at; return { checkId: c.id };
		}
		case "retire_check": {
			assertIdle(); const c = check(); c.retired = true; return { checkId: c.id };
		}
		case "preferences": data.preferences = parseLearningPreferences(b); return data.preferences;
		case "start_review": {
			const existing = active(); if (existing) return publicLearningAttempt(existing);
			const g = b.goalId ? goal() : selectDueGoal(data, now);
			if (!g || g.archived) throw new LearningError("No due goals with checked answer keys. Add a question or choose extra practice.", 409);
			const c = selectReviewCheck(data, g.id);
			if (!c) throw new LearningError("Check an answer key before starting this goal.", 409);
			const a: LearningAttempt = { id: newId(), goalId: g.id, checkId: c.id, startedAt: at, check: structuredClone(c), condition: g.condition, assisted: false };
			data.attempts.push(a); return publicLearningAttempt(a);
		}
		case "reveal": {
			const a = attempt();
			if (!a.submittedAt && !a.cancelledAt) { a.assisted = true; a.revealedAt ??= at; }
			return publicLearningAttempt(a);
		}
		case "cancel_review": {
			const a = attempt(); if (!a.submittedAt) a.cancelledAt ??= at;
			return publicLearningAttempt(a);
		}
		case "submit_answer": {
			const a = attempt();
			if (a.cancelledAt) throw new LearningError("This review was ended. Start a new review.", 409);
			const answer = learningText(b.answer, "Your answer", 16000);
			if (typeof b.assisted !== "boolean") throw new LearningError("Declare whether you used help.");
			if (b.confidence !== undefined && (typeof b.confidence !== "number" || b.confidence < 0 || b.confidence > 100 || !Number.isFinite(b.confidence))) throw new LearningError("Confidence must be 0–100.");
			if (a.submittedAt) {
				if (a.answer !== answer) throw new LearningError("This attempt was already submitted. Start another review to try again.", 409);
				return publicLearningAttempt(a);
			}
			a.answer = answer; a.submittedAt = at; a.assisted ||= b.assisted;
			a.confidence = b.confidence as number | undefined;
			a.grading = a.check.answerMode === "rubric" ? "self" : "answer-key";
			a.outcome = gradeLearningAnswer(a.check, answer);
			return publicLearningAttempt(a);
		}
		case "self_grade": {
			const a = attempt();
			if (!a.submittedAt || a.grading !== "self") throw new LearningError("Submit a rubric answer before self-assessing.", 409);
			const outcome = oneOf(b.outcome, ["correct", "partial", "incorrect"], "self-assessment");
			if (a.outcome && a.outcome !== outcome) throw new LearningError("This self-assessment is already saved.", 409);
			a.outcome = outcome; return publicLearningAttempt(a);
		}
		default: throw new LearningError("Unknown learning action.");
	}
}

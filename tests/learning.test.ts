import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	applyLearningCommand, DAY_MS, emptyLearningData, evaluateLearning, gradeLearningAnswer,
	isIndependentEvidence, learningProgress, learningSnapshot, parseCheckInput, parseLearningData,
	selectDueGoal, type LearningAttempt, type LearningCheck, type LearningData,
} from "../src/core/learning.ts";
import { createLearningStore } from "../src/store/learning.ts";
import { learningTools } from "../src/agent/tools/learning.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { newThinkingMessage, newUserMessage } from "../src/core/native-messages.ts";

const epoch = Date.parse("2026-01-01T12:00:00.000Z");
const checkInput = { prompt: "What is 6 × 7? Answer as a number.", kind: "recall", answerMode: "numeric", answer: "42", tolerance: 0, source: "Verified multiplication: 6 × 7 = 42" };

function fixture() {
	const data = emptyLearningData();
	let sequence = 0, now = epoch;
	const command = (body: Record<string, unknown>) => applyLearningCommand(data, body, now, () => `learn_${++sequence}`) as any;
	const goalId = command({ action: "create_goal", title: "Multiplication", objective: "Apply multiplication to unfamiliar groups." }).goalId as string;
	const addCheck = (overrides: Record<string, unknown> = {}) => {
		const id = command({ action: "add_check", goalId, ...checkInput, ...overrides }).checkId as string;
		command({ action: "approve_key", checkId: id, confirmed: true }); return id;
	};
	const review = (answer = "42", assisted = false) => {
		const a = command({ action: "start_review", goalId }) as LearningAttempt;
		command({ action: "submit_answer", attemptId: a.id, answer, assisted });
		return data.attempts.find(x => x.id === a.id)!;
	};
	return { data, goalId, command, addCheck, review, time: (days: number) => { now = epoch + days * DAY_MS; }, now: () => now };
}

describe("learning evidence and scheduling", () => {
	it("retries creation after a lost response without duplicating goals or questions", () => {
		const f = fixture();
		const body = { action: "create_goal", requestId: "request_1", title: "Vectors", objective: "Add vectors in a new problem." };
		assert.equal(f.command(body).goalId, f.command(body).goalId);
		assert.equal(f.data.goals.length, 2);
		assert.throws(() => f.command({ ...body, title: "Other" }), /different goal/);
		const check = { action: "add_check", requestId: "request_2", goalId: f.goalId, ...checkInput };
		assert.equal(f.command(check).checkId, f.command(check).checkId);
		assert.equal(f.data.checks.length, 1);
		assert.throws(() => f.command({ ...check, answer: "43" }), /different question/);
	});
	it("covered concepts and model observations cannot establish mastery", () => {
		const f = fixture(), g = f.data.goals[0]!;
		assert.equal(learningProgress(g, f.data, epoch).state, "not-assessed");
		f.data.observations.push({ id: "obs_1", goalId: g.id, chatId: "chat_1", messageId: "msg_1", quote: "I understand", note: "Model judgment", judgment: "progress", at: new Date(epoch).toISOString() });
		const p = learningProgress(g, f.data, epoch);
		assert.equal(p.state, "practiced"); assert.equal(p.independentPasses, 0);
	});
	it("requires distinct delayed application, then a seven-day retrieval for retention", () => {
		const f = fixture(); f.addCheck();
		f.review();
		f.addCheck({ prompt: "Seven boxes each hold six tiles. How many tiles?", kind: "transfer" });
		assert.equal(learningProgress(f.data.goals[0]!, f.data, f.now()).state, "practiced");
		f.time(1); const transfer = f.review(); assert.equal(transfer.check.kind, "transfer");
		assert.equal(learningProgress(f.data.goals[0]!, f.data, f.now()).state, "demonstrated");
		f.time(8); f.review();
		assert.equal(learningProgress(f.data.goals[0]!, f.data, f.now()).state, "retained");
		f.time(9); f.review("41");
		assert.equal(learningProgress(f.data.goals[0]!, f.data, f.now()).state, "practiced");
	});
	it("same-day repetition cannot manufacture retention or delay a scheduled review", () => {
		const f = fixture(); f.addCheck(); f.addCheck({ prompt: "Different groups?", kind: "transfer" });
		f.review(); const due = learningProgress(f.data.goals[0]!, f.data, f.now()).nextDueAt;
		for (let i = 0; i < 10; i++) { f.time(i / 100); f.review(); }
		const p = learningProgress(f.data.goals[0]!, f.data, f.now());
		assert.equal(p.state, "practiced"); assert.equal(p.nextDueAt, due); assert.equal(p.intervalDays, 1);
	});
	it("a late miss resets to a short interval; an early miss never postpones a nearer due date", () => {
		const f = fixture(); f.addCheck(); f.review(); f.time(0.5); f.review("wrong");
		assert.equal(learningProgress(f.data.goals[0]!, f.data, f.now()).nextDueAt, new Date(epoch + DAY_MS).toISOString());
		f.time(10); f.review("wrong");
		assert.equal(learningProgress(f.data.goals[0]!, f.data, f.now()).nextDueAt, new Date(epoch + 11 * DAY_MS).toISOString());
	});
	it("interleaves due goals and refuses an unreviewed answer bank", () => {
		const f = fixture();
		assert.throws(() => f.command({ action: "start_review" }), /No due/);
		const unreviewed = f.command({ action: "add_check", goalId: f.goalId, ...checkInput }).checkId;
		assert.throws(() => f.command({ action: "start_review", goalId: f.goalId }), /Check an answer key/);
		f.command({ action: "approve_key", checkId: unreviewed, confirmed: true });
		const other = f.command({ action: "create_goal", title: "Another", objective: "Another measurable skill." }).goalId;
		const otherCheck = f.command({ action: "add_check", goalId: other, ...checkInput }).checkId;
		f.command({ action: "approve_key", checkId: otherCheck, confirmed: true });
		f.review(); f.time(2);
		assert.equal(selectDueGoal(f.data, f.now())?.id, other);
	});
	it("uses stable server attempts, commits once, and never trusts a client verdict", () => {
		const f = fixture(); f.addCheck();
		const first = f.command({ action: "start_review" });
		assert.equal(f.command({ action: "start_review" }).id, first.id);
		const r = f.command({ action: "submit_answer", attemptId: first.id, answer: "41", assisted: false, outcome: "correct", submittedAt: "2099-01-01" });
		assert.equal(r.outcome, "incorrect"); assert.equal(r.submittedAt, new Date(epoch).toISOString());
		assert.equal(f.command({ action: "submit_answer", attemptId: first.id, answer: "41", assisted: false }).id, first.id);
		assert.equal(f.data.attempts.length, 1);
		assert.throws(() => f.command({ action: "submit_answer", attemptId: first.id, answer: "42", assisted: false }), /already submitted/);
	});
	it("hides solutions until submission and treats cross-tab key inspection as assistance", () => {
		const f = fixture(); const checkId = f.addCheck();
		const a = f.command({ action: "start_review" });
		assert.ok(!("answer" in a.check)); assert.ok(!("solution" in a));
		assert.ok(!("answer" in learningSnapshot(f.data, epoch).checks[0]!));
		f.command({ action: "inspect_key", checkId });
		const done = f.command({ action: "submit_answer", attemptId: a.id, answer: "42", assisted: false });
		assert.equal(done.assisted, true); assert.equal(done.solution.answer, "42");
		assert.equal(isIndependentEvidence(f.data.attempts[0]!), false);
		f.time(1); f.command({ action: "start_review" });
		assert.ok(learningSnapshot(f.data, f.now()).attempts.every(a => !a.solution));
	});
	it("revealing the solution is irreversible for the attempt; ending does not record a failure", () => {
		const f = fixture(); f.addCheck(); const a = f.command({ action: "start_review" });
		f.command({ action: "reveal", attemptId: a.id }); f.command({ action: "cancel_review", attemptId: a.id });
		assert.equal(learningProgress(f.data.goals[0]!, f.data, epoch).attempts, 0);
		assert.throws(() => f.command({ action: "submit_answer", attemptId: a.id, answer: "42", assisted: false }), /ended/);
	});
	it("rubrics are self-assessed and resume after reload without inflating mastery", () => {
		const f = fixture(); f.addCheck({ answerMode: "rubric", answer: "Explain the grouping and verify with a different method." });
		const a = f.review("Six groups of seven.");
		assert.equal(a.grading, "self"); assert.equal(a.outcome, undefined);
		assert.equal(learningSnapshot(f.data, epoch).active?.id, a.id);
		assert.equal(f.command({ action: "start_review" }).id, a.id);
		f.command({ action: "self_grade", attemptId: a.id, outcome: "correct" });
		assert.equal(learningSnapshot(f.data, epoch).active, undefined);
		assert.equal(learningProgress(f.data.goals[0]!, f.data, epoch).independentPasses, 0);
	});
	it("snapshots preserve old keys; retired questions never enter the queue", () => {
		const f = fixture(); const checkId = f.addCheck(); f.review();
		f.command({ action: "retire_check", checkId });
		assert.equal(f.data.attempts[0]!.check.retired, false);
		assert.equal(f.data.attempts[0]!.check.answer, "42");
		assert.throws(() => f.command({ action: "start_review", goalId: f.goalId }), /Check an answer key/);
	});
	it("compares numbers strictly and keeps exact matching honest", () => {
		const f = fixture(); const id = f.addCheck(); const c = f.data.checks.find(c => c.id === id)!;
		for (const invalid of ["", "0x2a", "42 cats", "Infinity", "NaN", "4,2", "42+0"]) assert.equal(gradeLearningAnswer(c, invalid), "incorrect");
		assert.equal(gradeLearningAnswer(c, "4.2e1"), "correct");
		assert.equal(gradeLearningAnswer({ ...c, answer: "0.2", tolerance: 0.1 }, "0.3"), "correct");
		assert.equal(gradeLearningAnswer({ ...c, answer: "NaN" }, "42"), "incorrect");
		assert.equal(gradeLearningAnswer({ ...c, answerMode: "exact", answer: "New York" }, " New  York "), "correct");
		assert.equal(gradeLearningAnswer({ ...c, answerMode: "exact", answer: "New York" }, "new york"), "incorrect");
		assert.throws(() => parseCheckInput({ ...checkInput, sourceUrl: "javascript:alert(1)" }), /HTTP/);
		assert.throws(() => parseCheckInput({ ...checkInput, sourceUrl: "https://user:password@example.org" }), /credentials/);
		assert.throws(() => parseCheckInput({ ...checkInput, tolerance: Infinity }), /finite/);
	});
	it("reports null with no delayed tests and separates condition, self-rating, assistance", () => {
		const f = fixture(); f.addCheck(); f.review();
		f.addCheck({ prompt: "Apply to a novel example", kind: "transfer" });
		assert.equal(evaluateLearning(f.data)[0]!.unaidedDelayedTransferRate, null);
		f.time(8); f.review("42", true);
		const report = evaluateLearning(f.data);
		assert.equal(report[0]!.delayedTransferAttempts, 1);
		assert.equal(report[0]!.unaidedDelayedTransferPasses, 0);
		assert.equal(report[0]!.unaidedDelayedTransferRate, 0);
		assert.equal(report[1]!.unaidedDelayedTransferRate, null);
	});
});

describe("learning persistence", () => {
	it("round-trips under a separate data directory, does not commit rejected changes, and preserves corrupt/newer history", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-learning-"));
		let notifications = 0;
		try {
			const store = createLearningStore(directory, () => notifications++);
			assert.deepEqual(store.read(), emptyLearningData());
			store.update(data => applyLearningCommand(data, { action: "create_goal", title: "A", objective: "Do A." }, epoch, () => "goal_1"));
			assert.equal(store.read().goals[0]?.id, "goal_1"); assert.equal(notifications, 1);
			const original = fs.readFileSync(path.join(directory, "learning.json"), "utf8");
			assert.throws(() => store.update(data => { data.goals = []; throw new Error("rejected"); }), /rejected/);
			assert.equal(fs.readFileSync(path.join(directory, "learning.json"), "utf8"), original);
			assert.equal(fs.existsSync(path.join(directory, "learning.lock")), false);
			store.update(() => undefined); assert.equal(notifications, 1);
			fs.writeFileSync(path.join(directory, "learning.lock"), "other process");
			assert.throws(() => store.update(() => undefined), /busy/);
			fs.unlinkSync(path.join(directory, "learning.lock"));
			for (const damaged of ["{bad json", JSON.stringify({ ...emptyLearningData(), version: 999 }), JSON.stringify({ ...emptyLearningData(), goals: [{}] })]) {
				fs.writeFileSync(path.join(directory, "learning.json"), damaged);
				assert.throws(() => store.read(), /preserved/);
				assert.throws(() => store.update(data => { data.goals = []; }), /preserved/);
				assert.equal(fs.readFileSync(path.join(directory, "learning.json"), "utf8"), damaged);
			}
			assert.deepEqual(fs.readdirSync(directory), ["learning.json"]);
		} finally { fs.rmSync(directory, { recursive: true, force: true }); }
	});
	it("rejects malformed records without assuming they are empty", () => {
		assert.throws(() => parseLearningData({ ...emptyLearningData(), attempts: {} }), /attempts/);
		assert.throws(() => parseLearningData({ ...emptyLearningData(), preferences: { style: "adaptive", sessionMinutes: 0 } }), /5–120/);
	});
});

describe("tutor learning tools", () => {
	it("proposes unapproved keys, deduplicates replay, attributes only learner prose, and cannot certify mastery", async () => {
		let data = emptyLearningData();
		const user = newUserMessage("There are six groups of seven, so I multiply them to get forty-two.");
		const thought = newThinkingMessage("problem_1", "I used addition because I confused the operation.");
		const tools = learningTools({
			chatId: "chat_1", chatStore: { getChat: () => ({ id: "chat_1", title: "Study", createdAt: new Date(epoch).toISOString(), updatedAt: new Date(epoch).toISOString(), messages: [user, thought] }) },
			graphStore: { readNodes: () => [] }, store: { read: () => structuredClone(data), update: fn => { const next = structuredClone(data); const result = fn(next); parseLearningData(next); data = next; return result; } },
		});
		const call = (name: string, input: unknown) => tools[name]!.execute("call_1", input);
		const proposal = { title: "Multiplication", objective: "Apply multiplication.", checks: [checkInput] };
		assert.ok(!(await call("propose_learning_goal", proposal)).isError);
		await call("propose_learning_goal", proposal);
		assert.equal(data.goals.length, 1); assert.equal(data.checks.length, 1); assert.equal(data.checks[0]!.keyReviewedAt, undefined);
		const goalId = data.goals[0]!.id;
		assert.ok((await call("record_learning_observation", { goalId, quote: "Invented answer", note: "Knows it", judgment: "progress" })).isError);
		const evidence = { goalId, quote: "I used addition because I confused the operation.", note: "Confuses addition with multiplication.", judgment: "misconception" };
		await call("record_learning_observation", evidence); await call("record_learning_observation", evidence);
		assert.equal(data.observations.length, 1); assert.equal(data.observations[0]!.messageId, thought.id);
		assert.equal(learningProgress(data.goals[0]!, data, Date.now()).state, "practiced");
		assert.deepEqual(Object.keys(tools).sort(), ["learning_status", "propose_learning_goal", "record_learning_observation"]);
		const status = JSON.stringify((await call("learning_status", {})).details);
		assert.ok(!status.includes('"answer":')); assert.ok(status.includes("misconception"));
	});
	it("all tutoring roles receive the evidence policy and no longer promise permanent understanding", () => {
		for (const kind of ["prober", "teacher", "practice"] as const) assert.match(composeInstructions(kind), /Persistent learning and delayed application/);
		const teacher = composeInstructions("teacher");
		assert.doesNotMatch(teacher, /Understood facts don't|No other teaching methods come close/);
		assert.match(teacher, /uncertain interpretations/);
		assert.match(teacher, /Worked examples/);
	});
});

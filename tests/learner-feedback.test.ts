import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFauxCore } from "@earendil-works/pi-ai";
import { compactAnswerForModel, dismissedAnswer, type QuestionAnswerData } from "../src/core/question-core.ts";
import { learnerProseOf, newAnswerResult, toLlmMessages } from "../src/core/native-messages.ts";
import { serializeForSummary } from "../src/core/compaction.ts";
import { applyLearningCommand, emptyLearningData } from "../src/core/learning.ts";
import { learningContextSnapshot } from "../src/core/learning-context.ts";
import { createLearningStore } from "../src/store/learning.ts";
import { learningTools } from "../src/agent/tools/learning.ts";
import { composeInstructions, createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { learningPromptContext } from "../src/server/learning.ts";
import { stores } from "../src/server/stores.ts";

const at = "2026-01-01T12:00:00.000Z";
const reading = "Why does await not block the whole thread?";
const thinking = "I confused task suspension with blocking a thread.";
function answer(extra: Partial<QuestionAnswerData> = {}): QuestionAnswerData {
	return { kind: "quiz", questionText: "What does await do?", dontKnow: false, answers: [], answeredAt: at, ...extra };
}

describe("learner feedback survives answers, skips, replay, and compaction", () => {
	it("a skip keeps questions in both thinking lanes without claiming a verdict or selection", () => {
		const data = { ...answer({ correct: true, confidence: 100, text: "unsubmitted answer" }),
			...dismissedAnswer("quiz", "What does await do?"), thinking, readingThinking: reading };
		assert.deepEqual(compactAnswerForModel(data), { kind: "quiz", dismissed: true, thinking, thinkingWhileReading: reading });
		assert.deepEqual(compactAnswerForModel({ ...data, thinking: undefined, note: "legacy thought" }),
			{ kind: "quiz", dismissed: true, thinking: "legacy thought", thinkingWhileReading: reading });
	});

	it("old saved dismissals recover reading questions on the provider wire and in summaries without a disk migration", () => {
		const saved = newAnswerResult("question_1", "quiz", { ...dismissedAnswer("quiz", "Q?"), readingThinking: reading });
		saved.content = [{ type: "text", text: '{"kind":"quiz","dismissed":true}' }];
		const original = structuredClone(saved);
		const wire = toLlmMessages([saved]);
		assert.match(JSON.stringify(wire[0]!.content), /Why does await/);
		assert.match(serializeForSummary([saved]), /Why does await/);
		assert.deepEqual(saved, original, "reading history must not mutate the persisted record");
	});

	it("compaction keeps a follow-up after a long answer and omits the tutor's solution", () => {
		const result = newAnswerResult("question_1", "explain", answer({ kind: "explain", text: "My reasoning. ".repeat(400),
			readingThinking: reading, committed: "PRIVATE MODEL SOLUTION" }));
		const summary = serializeForSummary([result]);
		assert.match(summary, /LEARNER ANSWER/);
		assert.match(summary, /Why does await/);
		assert.ok(!summary.includes("PRIVATE MODEL SOLUTION"));
		assert.ok(!summary.includes("[truncated]"));
	});
});

describe("attributable learner prose", () => {
	for (const [tool, kind] of [["quiz", "quiz"], ["probe", "quiz"], ["explain", "explain"],
		["recall", "explain"], ["ask_user_question", "ask"]] as const) {
		it(`accepts learner fields in ${tool} while excluding model-authored options and keys`, () => {
			const result = newAnswerResult("question_1", tool, answer({ kind, text: "My own answer", other: "My other choice",
				thinking, readingThinking: reading, committed: "Tutor solution", explanation: "Tutor explanation",
				answers: [{ label: "Tutor option label", value: "option", index: 1 }] }));
			assert.deepEqual(learnerProseOf(result), ["My own answer", "My other choice", thinking, reading]);
		});
	}
	it("rejects arbitrary tool results, failed questions, malformed details, and unsubmitted skipped text", () => {
		const result = newAnswerResult("question_1", "quiz", answer({ thinking, text: "draft answer" }));
		assert.deepEqual(learnerProseOf({ ...result, toolName: "read" }), []);
		assert.deepEqual(learnerProseOf({ ...result, isError: true }), []);
		assert.deepEqual(learnerProseOf({ ...result, details: { text: "invented" } }), []);
		assert.deepEqual(learnerProseOf(newAnswerResult("question_1", "quiz", answer({ dismissed: true,
			text: "draft answer", thinking, readingThinking: reading }))), [thinking, reading]);
	});
});

describe("persistent observations return to future tutors", () => {
	it("persists quiz/reading quotes, rejects tutor text, deduplicates, reopens, and injects evidence in a new session", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-feedback-"));
		const previous = stores.learningStore;
		try {
			const store = createLearningStore(directory);
			store.update(data => applyLearningCommand(data, { action: "create_goal", title: "Async", objective: "Explain task suspension." },
				Date.parse(at), () => "goal_async"));
			const result = newAnswerResult("question_1", "quiz", answer({ thinking, readingThinking: reading,
				explanation: "Tutor explanation", answers: [{ label: "Tutor option", value: "option", index: 1 }] }));
			const messages = [result];
			const tools = learningTools({ store, chatId: "chat_original", graphStore: { readNodes: () => [] }, chatStore: { getChat: () => ({
				id: "chat_original", title: "Async", createdAt: at, updatedAt: at, messages,
			}) } });
			const observe = (quote: string) => tools.record_learning_observation!.execute("observe", {
				goalId: "goal_async", quote, note: "Clarify suspension; the follow-up is a question, not proof of a misconception.", judgment: "gap",
			});
			for (const quote of [thinking, reading]) assert.ok(!(await observe(quote)).isError);
			await observe(reading);
			for (const quote of ["Tutor explanation", "Tutor option", "What does await do?", `${thinking}\n${reading}`, "invented"])
				assert.equal((await observe(quote)).isError, true, quote);
			const reopened = createLearningStore(directory);
			assert.equal(reopened.read().observations.length, 2);
			assert.equal(reopened.read().observations[0]!.messageId, result.id);
			stores.learningStore = reopened;
			const context = learningPromptContext("chat_new");
			assert.ok(context.includes(reading));
			const faux = createFauxCore({});
			const agent = createTeacherAgent(undefined, { learningContext: context, engine: { model: faux.getModel(), streamFn: faux.streamSimple } });
			assert.ok(agent.state.systemPrompt.includes(reading), "future agent construction includes saved follow-ups automatically");
			assert.equal(reopened.read().observations.length, 2);
		} finally {
			stores.learningStore = previous;
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("bounds automatic context, labels excerpts, and retrieves older observations and goals without keys", async () => {
		const data = emptyLearningData();
		for (let i = 0; i < 102; i++) data.goals.push({ id: `goal_${i}`, title: "Async", objective: "x".repeat(2000),
			conceptIds: [], createdAt: at, archived: false, condition: "harness" });
		for (let i = 0; i < 12; i++) data.observations.push({ id: `obs_${i}`, goalId: "goal_0", chatId: "chat_old", messageId: `msg_${i}`,
			quote: `Question ${i}: ${"q".repeat(4000 - 20)}`, note: "n".repeat(4000), judgment: "gap", at });
		data.checks.push({ id: "check_1", goalId: "goal_0", prompt: "A review question", kind: "recall", answerMode: "exact",
			answer: "PRIVATE ANSWER KEY", tolerance: 0, source: "Checked reference", createdAt: at, author: "tutor", retired: false });
		const context = learningContextSnapshot(data, Date.parse(at), "chat_old");
		assert.equal(context.goals[0]!.id, "goal_0", "current-session goals are included even if older");
		assert.equal(context.goals.length, 10);
		assert.equal(context.observations.length, 8);
		assert.equal(context.observationCount, 12);
		assert.ok(context.observations.every(o => o.excerpted));
		assert.ok(JSON.stringify(context).length < 20_000);
		const tools = learningTools({ store: { read: () => data, update: fn => fn(data) }, chatId: "chat_new",
			graphStore: { readNodes: () => [] }, chatStore: { getChat: () => null } });
		const status = async (input: object) => (await tools.learning_status!.execute("status", input)).details as {
			nextGoalOffset: number | null; goals: Array<{ id: string; observationCount: number;
				nextObservationOffset: number | null; observations: Array<{ id: string; quote: string }> }>;
		};
		assert.equal((await status({})).nextGoalOffset, 100);
		assert.ok((await status({ goalOffset: 100 })).goals.some(g => g.id === "goal_0"));
		const latest = await status({ goalId: "goal_0" });
		assert.equal(latest.goals[0]!.observationCount, 12);
		assert.equal(latest.goals[0]!.nextObservationOffset, 5);
		assert.equal(latest.goals[0]!.observations[0]!.id, "obs_11");
		const oldest = await status({ goalId: "goal_0", observationOffset: 10 });
		assert.equal(oldest.goals[0]!.nextObservationOffset, null);
		assert.equal(oldest.goals[0]!.observations.at(-1)!.id, "obs_0");
		assert.ok(oldest.goals[0]!.observations[0]!.quote.length > 400);
		assert.ok(!JSON.stringify([context, latest, oldest]).includes("PRIVATE ANSWER KEY"));
		data.goals[0]!.archived = true;
		assert.equal(learningContextSnapshot(data, Date.parse(at)).observationCount, 0);
		assert.equal((await tools.learning_status!.execute("status", { goalId: "goal_0" })).isError, true);
	});

	it("all roles prioritize submitted questions and evidence over rigid questioning", () => {
		for (const role of ["teacher", "prober", "practice"] as const) {
			const prompt = composeInstructions(role);
			assert.match(prompt, /address any concrete question or changed request before continuing/i);
			assert.match(prompt, /before posing the next question/);
			assert.match(prompt, /later learner evidence repairs an earlier gap/);
		}
		assert.doesNotMatch(composeInstructions("teacher"), /One step, one fact|every step, with `quiz`|One step, one check/);
		assert.doesNotMatch(composeInstructions("practice"), /regardless of how much the learner is struggling|Never teach beyond a surgical line/);
	});
});

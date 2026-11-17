import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ChatStore, GraphStore } from "../../core/ports.ts";
import { learningProgress, parseCheckInput, parseGoalInput, type LearningStore, type LearningObservation } from "../../core/learning.ts";
import { invalidInputResult } from "../tool-execute.ts";
import { learnerProseOf } from "../../core/native-messages.ts";

export interface LearningToolContext {
	store: LearningStore;
	chatStore: Pick<ChatStore, "getChat">;
	graphStore: Pick<GraphStore, "readNodes">;
	chatId: string;
}

const draftCheckSchema = Type.Object({
	prompt: Type.String({ minLength: 1, maxLength: 8000 }),
	kind: Type.Union([Type.Literal("recall"), Type.Literal("transfer")]),
	answerMode: Type.Union([Type.Literal("exact"), Type.Literal("numeric"), Type.Literal("rubric")]),
	answer: Type.String({ minLength: 1, maxLength: 8000 }),
	tolerance: Type.Optional(Type.Number({ minimum: 0 })),
	source: Type.String({ minLength: 1, maxLength: 2000, description: "Real reference plus exact section/page or evidence locator. Never invent a citation." }),
	sourceUrl: Type.Optional(Type.String({ maxLength: 2000 })),
});

const proposalSchema = Type.Object({
	goalId: Type.Optional(Type.String({ description: "An existing active goal id, when adding fresh review variants." })),
	title: Type.String({ minLength: 1, maxLength: 160 }),
	objective: Type.String({ minLength: 1, maxLength: 2000 }),
	conceptIds: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
	checks: Type.Array(draftCheckSchema, { minItems: 1, maxItems: 8 }),
});

const statusSchema = Type.Object({
	goalId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
	goalOffset: Type.Optional(Type.Integer({ minimum: 0 })),
	observationOffset: Type.Optional(Type.Integer({ minimum: 0 })),
});

const observationSchema = Type.Object({
	goalId: Type.String(),
	quote: Type.String({ minLength: 1, maxLength: 4000, description: "Verbatim learner-authored quote from chat, a free-text answer, thinking, thinkingWhileReading, or practice thinking in this session. Never quote option labels or tutor solutions." }),
	note: Type.String({ minLength: 1, maxLength: 4000 }),
	judgment: Type.Union([Type.Literal("progress"), Type.Literal("gap"), Type.Literal("misconception")]),
});

function result(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value };
}

/** Additive tools shared by the prober, teacher, and practitioner. They can
 * propose checks and record attributed observations, never verify or grade. */
export function learningTools(ctx: LearningToolContext): Record<string, AgentTool<any>> {
	const status: AgentTool<typeof statusSchema> = {
		name: "learning_status", label: "Learning evidence",
		description: "Read active learning goals, delayed-review status, preferences, and tutor observations. Pass goalId for one goal, or goalOffset/nextGoalOffset to page goals (newest first, 100 per page). Observations are newest first, five per goal; use observationOffset/nextObservationOffset for older evidence. Covered concepts are not evidence of retention. Answer keys are never returned.",
		parameters: statusSchema,
		execute: async (_toolCallId, input) => {
			const data = ctx.store.read();
			const active = data.goals.filter(g => !g.archived).reverse();
			const goalOffset = input.goalOffset ?? 0;
			const goals = input.goalId ? active.filter(g => g.id === input.goalId) : active.slice(goalOffset, goalOffset + 100);
			if (input.goalId && !goals.length) return invalidInputResult("learning_status", ["Unknown or archived learning goal."]);
			const offset = input.observationOffset ?? 0;
			return result({ preferences: data.preferences, activeGoalCount: active.length,
				nextGoalOffset: !input.goalId && goalOffset + 100 < active.length ? goalOffset + 100 : null,
				goals: goals.map(g => {
					const observations = data.observations.filter(o => o.goalId === g.id).reverse();
					return {
						...g, progress: learningProgress(g, data, Date.now()),
						observations: observations.slice(offset, offset + 5), observationCount: observations.length,
						nextObservationOffset: offset + 5 < observations.length ? offset + 5 : null,
						checksAwaitingApproval: data.checks.filter(c => c.goalId === g.id && !c.retired && !c.keyReviewedAt).length,
						reviewQuestions: data.checks.filter(c => c.goalId === g.id && !c.retired).map(c => ({ id: c.id, prompt: c.prompt, kind: c.kind })),
					};
			}), note: "Demonstrated/retained are conservative observations against learner-checked keys, not certified mastery. Tutor observations are dated model judgments; later evidence may correct them." });
		},
	};
	const propose: AgentTool<typeof proposalSchema> = {
		name: "propose_learning_goal", label: "Propose review goal",
		description: "Save an agreed measurable learning goal and source-grounded review questions for later practice. Include recall and a fresh application task when suitable. This only proposes answer keys: the learner checks them in /review. Reuse an existing goal instead of duplicating it. Exact = case-sensitive answer after whitespace normalization; numeric = number without units; rubric = self-assessment, never automated certification.",
		parameters: proposalSchema, executionMode: "sequential",
		execute: async (toolCallId, input) => {
			try {
				const goalInput = parseGoalInput(input);
				const checks = input.checks.map(parseCheckInput);
				const nodes = new Set(ctx.graphStore.readNodes().map(n => n.id));
				if (goalInput.conceptIds.some(id => !nodes.has(id))) throw new Error("Unknown concept id; use learning_status / graph tools or omit graph links.");
				return result(ctx.store.update(data => {
					// Stable deduplication across replayed tool calls and fresh re-proposals.
					const existing = input.goalId ? data.goals.find(g => g.id === input.goalId && !g.archived)
						: data.goals.find(g => !g.archived && g.sourceChatId === ctx.chatId && g.objective === goalInput.objective);
					if (input.goalId && !existing) throw new Error("Unknown or archived goal id.");
					const at = new Date().toISOString(), id = existing?.id ?? `learn_${crypto.randomUUID()}`;
					if (!existing) data.goals.push({ ...goalInput, id, createdAt: at, archived: false, sourceChatId: ctx.chatId });
					let added = 0;
					for (const c of checks) {
						if (data.checks.some(old => old.goalId === id && old.prompt === c.prompt && old.answer === c.answer)) continue;
						data.checks.push({ ...c, id: `learn_${crypto.randomUUID()}`, goalId: id, createdAt: at, retired: false, author: "tutor" }); added++;
					}
					return { goalId: id, reviewUrl: "/review", keysAwaitingLearnerCheck: added, call: toolCallId };
				}));
			} catch (error) { return invalidInputResult("propose_learning_goal", [String(error instanceof Error ? error.message : error)]); }
		},
	};
	const observe: AgentTool<typeof observationSchema> = {
		name: "record_learning_observation", label: "Record learner evidence",
		description: "Record a tutor judgment linked to an exact learner quote in this session. Cannot mark mastery or change the review schedule. Never quote your own prose as learner evidence. For a quiz without learner prose, do not invent an observation.",
		parameters: observationSchema, executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			try {
				const record = ctx.chatStore.getChat(ctx.chatId);
				const message = record?.messages.findLast(m => learnerProseOf(m).some(text => text.includes(input.quote)));
				if (!message || !input.quote.trim()) throw new Error("No persisted learner message contains that exact quote.");
				return result(ctx.store.update(data => {
					if (!data.goals.some(g => g.id === input.goalId && !g.archived)) throw new Error("Unknown or archived learning goal.");
					const existing = data.observations.find(o => o.goalId === input.goalId && o.chatId === ctx.chatId && o.messageId === message.id && o.quote === input.quote);
					if (existing) return existing;
					const observation: LearningObservation = { ...input, id: `learn_${crypto.randomUUID()}`, chatId: ctx.chatId, messageId: message.id, at: new Date().toISOString() };
					data.observations.push(observation); return observation;
				}));
			} catch (error) { return invalidInputResult("record_learning_observation", [String(error instanceof Error ? error.message : error)]); }
		},
	};
	return { learning_status: status, propose_learning_goal: propose, record_learning_observation: observe };
}

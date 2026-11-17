import { learningProgress, type LearningData } from "./learning.ts";

/** Bounded, answer-key-free reminder injected afresh on every tutor turn.
 * Full observations remain in the store and are paged through learning_status.
 * Excerpts are labeled so a partial quote is never mistaken for full evidence. */
export function learningContextSnapshot(data: LearningData, now: number, chatId?: string) {
	const goals = data.goals.filter(g => !g.archived);
	const ids = new Set(goals.map(g => g.id));
	const observations = data.observations.filter(o => ids.has(o.goalId)).reverse()
		.sort((a, b) => b.at.localeCompare(a.at));
	const currentGoals = new Set(observations.filter(o => chatId && o.chatId === chatId).map(o => o.goalId));
	const relevant = goals.slice().reverse().sort((a, b) =>
		Number(Boolean(chatId && (b.sourceChatId === chatId || currentGoals.has(b.id)))) -
		Number(Boolean(chatId && (a.sourceChatId === chatId || currentGoals.has(a.id)))));
	return {
		preferences: data.preferences,
		activeGoalCount: goals.length,
		goals: relevant.slice(0, 10).map(g => ({
			id: g.id, title: g.title, objective: g.objective.slice(0, 240),
			objectiveTruncated: g.objective.length > 240, progress: learningProgress(g, data, now),
		})),
		observationCount: observations.length,
		observations: observations.slice(0, 8).map(o => ({
			...o, quote: o.quote.slice(0, 400), note: o.note.slice(0, 400),
			excerpted: o.quote.length > 400 || o.note.length > 400,
		})),
	};
}

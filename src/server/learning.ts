import { applyLearningCommand, evaluateLearning, LearningError, learningObject, learningSnapshot, pendingLearningAttempt } from "../core/learning.ts";
import { stores } from "./stores.ts";

/** A damaged optional learning file must not strand an otherwise valid chat turn. */
export function learningPromptContext(): string {
	try {
		return `Learner preferences (defaults until changed in Review): ${JSON.stringify(stores.learningStore.read().preferences)}. Adapt to these and any newer request in this conversation. Read learning_status for evidence before assuming prior mastery.`;
	} catch {
		return "Persistent learning history is currently unavailable. Do not infer mastery. Continue teaching from the conversation's evidence; mention the Review page can show the storage error.";
	}
}

export function getLearningSnapshot() {
	return learningSnapshot(stores.learningStore.read(), Date.now());
}

export async function handleLearningCommand(request: Request): Promise<Response> {
	try {
		const text = await request.text();
		if (text.length > 64_000) throw new LearningError("Learning request is too large.", 413);
		let body: unknown;
		try { body = JSON.parse(text); } catch { throw new LearningError("Invalid JSON request."); }
		const input = learningObject(body);
		if (input.action === "export") {
			const data = stores.learningStore.read();
			if (pendingLearningAttempt(data)) throw new LearningError("Finish or end the review before exporting answer keys.", 409);
			return Response.json({ ...data, evaluation: evaluateLearning(data), exportedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
		}
		if (input.action === "create_goal" && Array.isArray(input.conceptIds)) {
			const ids = new Set(stores.graphStore.readNodes().map(n => n.id));
			if (input.conceptIds.some(id => !ids.has(id))) throw new LearningError("A selected concept no longer exists. Refresh and select it again.");
		}
		const result = stores.learningStore.update(data => applyLearningCommand(data, body, Date.now(), () => `learn_${crypto.randomUUID()}`));
		return Response.json({ result, snapshot: getLearningSnapshot() }, { headers: { "Cache-Control": "no-store" } });
	} catch (error) { return learningErrorResponse(error); }
}

export function learningErrorResponse(error: unknown): Response {
	if (!(error instanceof LearningError)) console.error("[learning] operation failed", error);
	return Response.json({ error: error instanceof LearningError ? error.message : "Could not save learning history. Retry; your existing history is preserved." },
		{ status: error instanceof LearningError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

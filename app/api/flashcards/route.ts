import { flashcardService, flashcardErrorResponse } from "@/src/server";
import { LearningError } from "@/src/core";

export const dynamic = "force-dynamic";
export function GET() {
	try { return Response.json(flashcardService().snapshot(), { headers: { "Cache-Control": "no-store" } }); }
	catch (e) { return flashcardErrorResponse(e); }
}
export async function POST(request: Request) {
	try {
		const text = await request.text();
		if (text.length > 64_000) throw new LearningError("Flashcard request is too large.", 413);
		let body: unknown;
		try { body = JSON.parse(text); } catch { throw new LearningError("Invalid JSON request."); }
		return Response.json(await flashcardService().command(body), { headers: { "Cache-Control": "no-store" } });
	} catch (e) { return flashcardErrorResponse(e); }
}

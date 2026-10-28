import { getLearningSnapshot, handleLearningCommand, learningErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	try { return Response.json(getLearningSnapshot(), { headers: { "Cache-Control": "no-store" } }); }
	catch (error) { return learningErrorResponse(error); }
}

export const POST = handleLearningCommand;

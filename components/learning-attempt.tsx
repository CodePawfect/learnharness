"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MessageResponse } from "@/components/ai-elements/message";
import type { PublicAttempt } from "@/src/core";
import type { LearningCommand } from "./learning-forms";

export function LearningAttemptView({ attempt, title, command, busy, onDone }: {
	attempt: PublicAttempt; title: string; command: LearningCommand; busy: boolean; onDone: () => void;
}) {
	const id = useId();
	const answerRef = useRef<HTMLTextAreaElement>(null);
	const [answer, setAnswer] = useState("");
	const [help, setHelp] = useState(false);
	const [confidence, setConfidence] = useState("");
	const done = !!attempt.submittedAt || !!attempt.cancelledAt;
	const requiresRating = done && attempt.grading === "self" && !attempt.outcome;
	return <section className="mx-auto w-full max-w-3xl py-6" aria-labelledby={`${id}-heading`}>
		<p className="mb-3 text-sm text-muted-foreground">{attempt.check.kind === "transfer" ? "Independent application" : "Recall and understanding"} · {title}</p>
		<h2 id={`${id}-heading`} className="mb-6 text-2xl font-semibold tracking-tight">{done ? "Review your answer" : "Try it without help"}</h2>
		<div className="mb-6 text-base leading-relaxed"><MessageResponse>{attempt.check.prompt}</MessageResponse></div>
		{!done ? <form className="grid gap-5" onSubmit={async e => {
			e.preventDefault(); await command({ action: "submit_answer", attemptId: attempt.id, answer, assisted: help || attempt.assisted,
				...(confidence !== "" ? { confidence: Number(confidence) } : {}) });
		}}>
			<label className="grid gap-2 text-sm" htmlFor={`${id}-answer`}>Your answer<Textarea ref={answerRef} id={`${id}-answer`} name="answer" rows={5} className="min-h-36" value={answer} onChange={e => setAnswer(e.target.value)} required maxLength={16000} autoFocus /></label>
			<div className="grid items-start gap-4 sm:grid-cols-2">
				<label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={help || attempt.assisted} disabled={attempt.assisted} onChange={e => setHelp(e.target.checked)} className="size-4 accent-foreground" />I used notes, hints, or other help</label>
				<label htmlFor={`${id}-confidence`} className="grid gap-2 text-sm">Confidence, 0–100% (optional)<Input id={`${id}-confidence`} type="number" min="0" max="100" step="1" value={confidence} onChange={e => setConfidence(e.target.value)} /></label>
			</div>
			{attempt.assisted && <p role="status" className="text-sm text-muted-foreground">Help or an answer key was opened. This attempt counts as assisted practice.</p>}
			<div className="flex flex-wrap gap-3">
				<Button type="submit" disabled={busy || !answer.trim()}>Submit answer</Button>
				<Button type="button" variant="outline" disabled={busy || !!attempt.revealedAt} onClick={() => void command({ action: "reveal", attemptId: attempt.id })}>Show solution</Button>
				<Button type="button" variant="ghost" disabled={busy} onClick={async () => { if (await command({ action: "cancel_review", attemptId: attempt.id })) onDone(); }}>End review</Button>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground">Your answer is committed before the key is shown. Showing a solution marks the attempt as assisted; you can still practice.</p>
		</form> : <div className="space-y-4">
			{attempt.answer && <div><h3 className="mb-2 text-sm font-medium">Your submitted answer</h3><p className="whitespace-pre-wrap break-words text-base">{attempt.answer}</p></div>}
			<p role="status" className="text-sm font-medium">{attempt.cancelledAt ? "Review ended. No assessment recorded." : requiresRating ? "Answer saved. Compare it with the criteria below." : `${attempt.outcome === "correct" ? "Correct" : attempt.outcome === "partial" ? "Partly correct" : "Needs more practice"} · ${attempt.grading === "self" ? "Self-assessed" : "Checked against your reviewed answer key"}${attempt.assisted ? " · Assisted" : " · Reported unaided"}`}</p>
		</div>}
		{attempt.solution && <div className="mt-7 space-y-3 border-t border-border pt-5">
			<h3 className="text-sm font-medium">{attempt.check.answerMode === "rubric" ? "Acceptance criteria" : "Committed answer key"}</h3>
			<MessageResponse>{attempt.solution.answer}</MessageResponse>
			{attempt.check.answerMode === "numeric" && <p className="text-sm text-muted-foreground">Absolute tolerance: {attempt.solution.tolerance}</p>}
			<p className="break-words text-sm text-muted-foreground">Reference: {attempt.check.source}{attempt.check.sourceUrl && <> · <a className="underline underline-offset-4" href={attempt.check.sourceUrl} target="_blank" rel="noreferrer">Open source</a></>}</p>
			<p className="text-xs leading-relaxed text-muted-foreground">A checked key can still be wrong. If it is ambiguous or incorrect, retire the question and add a corrected version.</p>
		</div>}
		{requiresRating && <div className="mt-5 space-y-3"><p className="text-sm">How well did your answer meet the criteria? This is recorded as your own assessment.</p><div className="flex flex-wrap gap-3">{([ ["incorrect", "Not yet"], ["partial", "Partly"], ["correct", "Meets criteria"] ] as const).map(([outcome, label]) => <Button key={outcome} variant="outline" disabled={busy} onClick={() => void command({ action: "self_grade", attemptId: attempt.id, outcome })}>{label}</Button>)}</div></div>}
		{done && !requiresRating && <Button className="mt-6" onClick={onDone}>Back to review queue</Button>}
	</section>;
}

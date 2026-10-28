"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { LearningGoalForm, LearningCheckForm, LearningPreferences, type LearningCommand } from "./learning-forms";
import { LearningAttemptView } from "./learning-attempt";
import type { LearningCheck, LearningProgress, LearningSnapshot } from "@/src/core";

const states: Record<LearningProgress["state"], string> = { "not-assessed": "Not assessed", practiced: "Practiced", demonstrated: "Demonstrated", retained: "Retained" };
function date(iso: string): string { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }

export function LearningReview() {
	const [snapshot, setSnapshot] = useState<LearningSnapshot>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [selectedId, setSelectedId] = useState<string>();
	const [resultId, setResultId] = useState<string>();
	const [inspected, setInspected] = useState<LearningCheck>();
	const [confirmed, setConfirmed] = useState(false);
	const [showArchived, setShowArchived] = useState(false);
	const [newGoalOpen, setNewGoalOpen] = useState(false);
	const seq = useRef(0), pending = useRef(false);
	const retry = useRef<{ identity: string; requestId: string } | undefined>(undefined);
	const refresh = useCallback(async () => {
		if (pending.current) return;
		const request = ++seq.current;
		try {
			const response = await fetch("/api/learning", { cache: "no-store" });
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || "Could not load learning history.");
			if (request === seq.current) { setSnapshot(data); setError(undefined); }
		} catch (e) { if (request === seq.current) setError(e instanceof Error ? e.message : "Could not load learning history."); }
	}, []);
	useEffect(() => { void refresh(); return () => { seq.current++; }; }, [refresh]);
	useServerEvent("learning-changed", refresh);
	useServerResync(refresh);
	// Due dates advance even when this view stays open overnight. No server job or notification is scheduled.
	useEffect(() => { const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60_000); return () => clearInterval(timer); }, [refresh]);
	const command: LearningCommand = useCallback(async body => {
		if (pending.current) return undefined;
		pending.current = true; ++seq.current; setBusy(true); setError(undefined);
		let requestBody = body;
		if (body.action === "create_goal" || body.action === "add_check") {
			const identity = JSON.stringify(body);
			if (retry.current?.identity !== identity) retry.current = { identity, requestId: crypto.randomUUID() };
			requestBody = { ...body, requestId: retry.current.requestId };
		}
		try {
			const response = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) });
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || "Could not save learning history.");
			if (data.snapshot) setSnapshot(data.snapshot);
			if (body.action === "create_goal" || body.action === "add_check") retry.current = undefined;
			if ((body.action === "submit_answer" || body.action === "self_grade") && data.result?.id) setResultId(data.result.id);
			if (body.action === "start_review") { setInspected(undefined); setResultId(undefined); }
			return data.result ?? data;
		} catch (e) { setError(e instanceof Error ? e.message : "Could not save learning history."); return undefined; }
		finally { pending.current = false; setBusy(false); }
	}, []);
	const goals = snapshot?.goals.filter(g => showArchived || !g.archived) ?? [];
	const selected = goals.find(g => g.id === selectedId) ?? goals[0];
	const current = snapshot?.active ?? snapshot?.attempts.find(a => a.id === resultId);
	const selectedChecks = snapshot?.checks.filter(c => c.goalId === selected?.id && !c.retired) ?? [];
	const evidence = snapshot?.attempts.filter(a => a.goalId === selected?.id && a.submittedAt).slice().reverse() ?? [];
	const observations = snapshot?.observations.filter(o => o.goalId === selected?.id).slice().reverse() ?? [];
	return <div className="lh-learning flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
		<TopBar><span className="text-sm font-medium">Review</span><Link href="/chat/new" className="ml-auto text-sm underline underline-offset-4">Start a lesson</Link></TopBar>
		<div data-review-scroll className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10" aria-busy={busy}>
			<div className="mx-auto max-w-6xl">
				{error && <div role="alert" className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-destructive/50 p-4 text-sm"><p className="min-w-0 flex-1 break-words">{error}</p><Button variant="outline" onClick={() => void refresh()} disabled={busy}>Reload history</Button></div>}
				{!snapshot ? <p role="status" className="text-sm text-muted-foreground">{error ? "Learning history is unavailable. Your existing data has not been replaced." : "Loading learning history…"}</p> : current ?
					<LearningAttemptView key={current.id} attempt={current} title={snapshot.goals.find(g => g.id === current.goalId)?.title ?? "Learning goal"} command={command} busy={busy} onDone={() => { setResultId(undefined); void refresh(); }} /> : <>
					<div className="mb-7 flex flex-wrap items-start justify-between gap-4">
						<div><h1 className="text-2xl font-semibold tracking-tight">Keep what you learn</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{snapshot.dueCount ? `${snapshot.dueCount} learning ${snapshot.dueCount === 1 ? "goal is" : "goals are"} ready for review.` : "No reviews due with checked answer keys."} Practice recalling and applying ideas, then return after a delay.</p></div>
						<Button disabled={busy || snapshot.dueCount === 0} onClick={() => void command({ action: "start_review" })}>Start due review</Button>
					</div>
					<div className="mb-6 flex flex-wrap items-center gap-4"><Button variant="outline" onClick={() => setNewGoalOpen(v => !v)} aria-expanded={newGoalOpen}>{newGoalOpen ? "Close new goal" : "Add learning goal"}</Button><label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="size-4 accent-foreground" />Show archived</label><Button variant="ghost" className="ml-auto" disabled={busy} onClick={async () => {
						const data = await command({ action: "export" }); if (!data) return;
						const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
						const anchor = document.createElement("a"); anchor.href = url; anchor.download = "learnharness-learning-evidence.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
					}}>Export evidence</Button></div>
					{(newGoalOpen || snapshot.goals.length === 0) && <section className="mb-7 border-y border-border py-3" aria-label="New learning goal">
						{snapshot.goals.length === 0 && <p className="pt-3 text-sm leading-relaxed text-muted-foreground">Create a measurable goal below, or ask your tutor to propose one with review questions. Your existing concept graph stays available; a covered concept is not automatically marked as learned.</p>}
						<LearningGoalForm command={command} busy={busy} onCreated={id => { setSelectedId(id); setNewGoalOpen(false); }} />
					</section>}
					{goals.length > 0 && <div className="mb-8 grid min-w-0 gap-7 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
						<nav aria-label="Learning goals" className="min-w-0"><h2 className="mb-3 text-sm font-medium">Your learning goals</h2><ul className="divide-y divide-border border-y border-border">{goals.map(g => <li key={g.id}><button type="button" className={`w-full px-3 py-4 text-left focus-visible:outline-2 focus-visible:outline-ring ${g.id === selected?.id ? "bg-accent" : "hover:bg-accent/50"}`} aria-current={g.id === selected?.id ? "true" : undefined} onClick={() => { setSelectedId(g.id); setInspected(undefined); }}>
							<span className="block break-words text-sm font-medium">{g.title}</span><span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{g.archived ? "Archived" : states[g.progress.state]} · {snapshot.checks.some(c => c.goalId === g.id && c.keyReviewedAt && !c.retired) ? g.progress.due ? "Due now" : `Next: ${date(g.progress.nextDueAt)}` : "Needs a checked question"}</span>
						</button></li>)}</ul></nav>
						{selected && <section key={selected.id} className="min-w-0" aria-label="Selected learning goal">
							<h2 className="break-words text-xl font-semibold">{selected.title}</h2><p className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed">{selected.objective}</p>
							<p className="mt-3 text-sm text-muted-foreground">{states[selected.progress.state]} · {selected.progress.attempts} completed {selected.progress.attempts === 1 ? "review" : "reviews"} · {selected.progress.independentPasses} unaided checked {selected.progress.independentPasses === 1 ? "pass" : "passes"}</p>
							{selected.sourceChatId && <Link href={`/chat/${selected.sourceChatId}`} className="mt-3 inline-block text-sm underline underline-offset-4">Open source lesson</Link>}
							<div className="my-5 flex flex-wrap gap-3"><Button variant="outline" disabled={busy || selected.archived || !selectedChecks.some(c => c.keyReviewedAt)} onClick={() => void command({ action: "start_review", goalId: selected.id })}>{selected.progress.due ? "Review this goal" : "Extra practice"}</Button><Button variant="ghost" disabled={busy} onClick={() => void command({ action: "archive_goal", goalId: selected.id, archived: !selected.archived })}>{selected.archived ? "Restore goal" : "Archive goal"}</Button></div>
							{selected.progress.lastReviewedAt && <p className="mb-5 text-xs text-muted-foreground">Last review: {date(selected.progress.lastReviewedAt)}. Next: {date(selected.progress.nextDueAt)}. Early practice does not postpone a due review.</p>}
							{!selected.archived && <details className="border-y border-border py-3"><summary className="w-fit cursor-pointer py-1 text-sm font-medium">Add a review question</summary><LearningCheckForm goalId={selected.id} command={command} busy={busy} /></details>}
							<h3 className="mb-3 mt-6 text-sm font-medium">Review questions</h3>
							{selectedChecks.length === 0 && <p className="text-sm text-muted-foreground">Add a recall question and a different application task. Include a source you can use to check the answer.</p>}
							<ul className="divide-y divide-border">{selectedChecks.map(c => <li key={c.id} className="py-4"><p className="mb-2 text-sm leading-relaxed break-words">{c.prompt}</p><p className="mb-3 text-xs text-muted-foreground">{c.kind === "transfer" ? "Application" : "Recall"} · {c.answerMode === "rubric" ? "Self-assessed rubric" : "Answer-key check"} · {c.keyReviewedAt ? "Key checked by you" : "Key needs checking"}{c.author === "tutor" ? " · Tutor proposal" : ""}</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={async () => { const key = await command({ action: "inspect_key", checkId: c.id }); if (key) { setInspected(key as LearningCheck); setConfirmed(false); } }}>{c.keyReviewedAt ? "Inspect answer key" : "Check answer key"}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={async () => { if (await command({ action: "retire_check", checkId: c.id })) setInspected(undefined); }}>Retire question</Button></div></li>)}</ul>
							{inspected && inspected.goalId === selected.id && <section className="my-5 space-y-4 rounded-md border border-border p-4" aria-label="Answer key verification">
								<h3 className="text-sm font-medium">Check the proposed answer</h3><p className="text-sm break-words">{inspected.prompt}</p><MessageResponse>{inspected.answer}</MessageResponse><p className="break-words text-sm">Reference: {inspected.source}{inspected.sourceUrl && <> · <a href={inspected.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">Open source</a></>}</p>
								{inspected.answerMode === "numeric" && <p className="text-sm">Absolute tolerance: {inspected.tolerance}</p>}
								{!snapshot.checks.find(c => c.id === inspected.id)?.keyReviewedAt ? <><label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1 size-4 shrink-0 accent-foreground" />I checked the question and answer against this reference. The key is correct and the question is unambiguous.</label><Button disabled={busy || !confirmed} onClick={async () => { if (await command({ action: "approve_key", checkId: inspected.id, confirmed: true })) setInspected(undefined); }}>Confirm checked key</Button></> : <p className="text-sm text-muted-foreground">You confirmed this key. This records your verification; it is not an independent fact-check by the app.</p>}
								<Button variant="ghost" onClick={() => setInspected(undefined)}>Close answer key</Button>
							</section>}
							<details className="mt-6 border-t border-border py-4"><summary className="w-fit cursor-pointer py-1 text-sm font-medium">Evidence history ({evidence.length + observations.length})</summary><div className="mt-4 space-y-5">
								{evidence.length === 0 && observations.length === 0 && <p className="text-sm text-muted-foreground">No performance evidence yet. Reading a lesson does not create a passing assessment.</p>}
								{evidence.map(a => <div key={a.id} className="border-b border-border pb-4"><p className="text-xs text-muted-foreground">{date(a.submittedAt!)} · {a.check.kind} · {a.grading === "self" ? "Self-assessed" : "Answer-key check"} · {a.assisted ? "Assisted" : "Reported unaided"}</p><p className="mt-2 text-sm">{a.check.prompt}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">Your answer: {a.answer}</p><p className="mt-2 text-sm font-medium">{a.outcome ?? "Awaiting self-assessment"}</p></div>)}
								{observations.map(o => <div key={o.id} className="border-b border-border pb-4"><p className="text-xs text-muted-foreground">Tutor observation · {o.judgment} · {date(o.at)}</p><blockquote className="my-2 border-l-2 border-border pl-3 text-sm">{o.quote}</blockquote><p className="text-sm">{o.note}</p><Link href={`/chat/${o.chatId}`} className="mt-2 inline-block text-sm underline underline-offset-4">Inspect source conversation</Link></div>)}
							</div></details>
						</section>}
					</div>}
					<LearningPreferences preferences={snapshot.preferences} command={command} busy={busy} />
					<details className="border-t border-border py-5"><summary className="w-fit cursor-pointer py-1 text-sm font-medium">What the evidence means</summary><div className="mt-4 max-w-3xl space-y-3 text-sm leading-relaxed text-muted-foreground"><p>Practiced means there is an attempt or tutor observation. Demonstrated requires correct, unaided answers to distinct checked questions, including an application at least 24 hours after the first pass. Retained adds another correct retrieval after at least seven days. A later miss or assisted attempt reopens the question of independence.</p><p>These are observations against your checked keys, not a guarantee of mastery. Due dates remain visible even for retained goals. Self-assessed projects and tutor judgments stay labeled separately.</p><p>Intervals follow a transparent 1, 3, 7, 14, 30, 60 day heuristic. A miss or assistance shortens the interval. This schedule is not a calibrated prediction of your memory. Exported comparisons are descriptive; different subjects, prior knowledge, and self-selected study methods can affect results.</p></div></details>
				</>}
			</div>
		</div>
	</div>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TopBar } from "./top-bar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { MessageResponse } from "./ai-elements/message";
import { useServerEvent, useServerResync } from "./server-events";
import type { FlashcardSnapshot } from "@/src/core";

type Snapshot = FlashcardSnapshot & { sync: { running: boolean; pending: number; currentTitle?: string; errors: Array<{ chatId: string; title: string; message: string }> } };
type Command = (body: Record<string, unknown>) => Promise<boolean>;

export function Flashcards() {
	const [snapshot, setSnapshot] = useState<Snapshot>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [count, setCount] = useState("");
	const seq = useRef(0), pending = useRef(false), startId = useRef<string | undefined>(undefined);
	const refresh = useCallback(async () => {
		if (pending.current) return;
		const id = ++seq.current;
		try {
			const response = await fetch("/api/flashcards", { cache: "no-store" });
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || "Could not load flashcards.");
			if (id === seq.current) setSnapshot(data);
		} catch (e) { if (id === seq.current) setError(e instanceof Error ? e.message : "Could not load flashcards."); }
	}, []);
	const command: Command = useCallback(async body => {
		if (pending.current) return false;
		pending.current = true; ++seq.current; setBusy(true); setError(undefined);
		try {
			const response = await fetch("/api/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || "Could not save flashcards.");
			setSnapshot(data); return true;
		} catch (e) { setError(e instanceof Error ? e.message : "Could not save flashcards."); return false; }
		finally { pending.current = false; setBusy(false); void refresh(); }
	}, [refresh]);
	useEffect(() => { void command({ action: "sync" }); return () => { ++seq.current; }; }, [command]);
	useServerEvent("flashcards-changed", refresh);
	useServerResync(refresh);
	useEffect(() => { const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60_000); return () => clearInterval(timer); }, [refresh]);
	const topics = snapshot?.topics.filter(t => t.count > 0) ?? [];
	const selectedCards = snapshot?.cards.filter(c => selected.includes(c.topicId)) ?? [];
	const available = selectedCards.length;
	const countValid = /^\d+$/.test(count) && Number(count) >= 1 && Number(count) <= available;
	return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
		<TopBar><span className="text-sm font-medium">Flashcards</span><Link href="/review" className="ml-auto text-sm underline underline-offset-4">Review</Link></TopBar>
		<div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10" aria-busy={busy}>
			<div className="mx-auto max-w-5xl">
				{error && <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-destructive/50 p-4 text-sm"><p className="min-w-0 flex-1 break-words">{error}</p><Button variant="outline" onClick={() => { setError(undefined); void refresh(); }} disabled={busy}>Reload</Button></div>}
				{!snapshot ? <p role="status" className="text-sm text-muted-foreground">{error ? "Flashcards are unavailable. Reload to retry." : "Loading flashcards…"}</p> : snapshot.active ?
					<FlashcardRound key={snapshot.active.attempt.id} active={snapshot.active} topics={snapshot.topics} command={command} busy={busy} /> : <>
					<h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Cards grow from completed sections of your lessons. Choose topics and a total number of cards, then answer in your own words.</p>
					<section className="mt-6 border-y border-border py-4" aria-label="Lesson processing">
						<div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="min-w-0 break-words text-sm">{snapshot.sync.running ? `Creating cards${snapshot.sync.currentTitle ? ` · ${snapshot.sync.currentTitle}` : " from your lessons"}…` : `${snapshot.checkedSessions} ${snapshot.checkedSessions === 1 ? "session" : "sessions"} checked${snapshot.deferredSessions ? ` · ${snapshot.deferredSessions} with unfinished sections` : ""}`}</p><Button variant="outline" size="sm" disabled={busy || snapshot.sync.running} onClick={() => void command({ action: "sync" })}>{snapshot.sync.errors.length ? "Retry lesson processing" : "Check lessons"}</Button></div>
						{snapshot.sync.running && <p className="mt-2 text-sm text-muted-foreground">You can study existing cards while the remaining lessons are processed.</p>}
						{snapshot.sync.errors.length > 0 && <div className="mt-4 space-y-3" role="alert">{snapshot.sync.errors.map(e => <p key={e.chatId} className="break-words text-sm"><Link href={`/chat/${e.chatId}`} className="font-medium underline underline-offset-4">{e.title}</Link>: {e.message}</p>)}</div>}
					</section>
					{snapshot.lastSession && <p role="status" className="mt-5 text-sm">Last round: {snapshot.lastSession.completed} of {snapshot.lastSession.total} cards reviewed · {snapshot.lastSession.correct} correct.</p>}
					{topics.length === 0 ? <div className="py-10"><h2 className="text-lg font-medium">Your cards will appear here</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Existing lessons are checked automatically. A section needs taught material, your attempt, and tutor feedback before it becomes flashcards. Unfinished sections are picked up as you continue learning.</p><Link href="/chat/new" className="mt-5 inline-block text-sm underline underline-offset-4">Continue learning</Link></div> : <form className="mt-8" onSubmit={async e => {
						e.preventDefault(); startId.current ??= crypto.randomUUID();
						if (await command({ action: "start", topicIds: selected, count: Number(count), requestId: startId.current })) startId.current = undefined;
					}}>
						<fieldset disabled={busy}><legend className="text-lg font-semibold">Choose topics</legend><p className="mb-4 mt-2 text-sm text-muted-foreground">Select one topic for focused practice or several for a mixed round.</p>
							<div className="divide-y divide-border border-y border-border">{topics.map(t => <label key={t.id} className={`flex min-h-16 cursor-pointer items-center gap-4 px-3 py-4 ${selected.includes(t.id) ? "bg-accent/60" : "hover:bg-accent/30"}`}><input type="checkbox" className="size-4 shrink-0 accent-foreground" checked={selected.includes(t.id)} onChange={e => { startId.current = undefined; setSelected(ids => e.target.checked ? [...ids, t.id] : ids.filter(id => id !== t.id)); }} /><span className="min-w-0 flex-1 break-words text-sm font-medium">{t.name}</span><span className="shrink-0 text-right text-sm tabular-nums text-muted-foreground">{t.count} {t.count === 1 ? "card" : "cards"}<span className="mt-1 block text-xs">{t.dueCount} due</span></span></label>)}</div>
						</fieldset>
						<div className="mt-6 flex flex-wrap items-end gap-4"><label htmlFor="flashcard-count" className="grid gap-2 text-sm">Cards in this round<Input id="flashcard-count" name="count" type="number" min="1" max={available || undefined} step="1" required className="w-40" value={count} onChange={e => { startId.current = undefined; setCount(e.target.value); }} disabled={busy || !available} aria-describedby="flashcard-available" /></label><Button type="submit" disabled={busy || !countValid}>Start learning</Button></div>
						<p id="flashcard-available" className="mt-3 text-sm text-muted-foreground">{available ? `${available} cards available across ${selected.length} selected ${selected.length === 1 ? "topic" : "topics"}. Due cards and difficult answers are prioritized.` : "Select at least one topic to start."}</p>
						{selectedCards.length > 0 && <details className="mt-8 border-t border-border py-4"><summary className="w-fit cursor-pointer py-2 text-sm font-medium">Browse selected cards ({selectedCards.length})</summary><ul className="mt-3 divide-y divide-border">{selectedCards.map(c => <li key={c.id} className="py-4"><p className="break-words text-sm">{c.question}</p><p className="mt-2 text-xs text-muted-foreground">{topics.find(t => t.id === c.topicId)?.name} · {c.progress.due ? "Due now" : `Next: ${new Date(c.progress.nextDueAt).toLocaleString()}`}</p>{c.sources.map(s => <Link key={s.chatId} href={`/chat/${s.chatId}`} className="mr-4 mt-2 inline-block text-sm underline underline-offset-4">Open source lesson</Link>)}</li>)}</ul></details>}
					</form>}
				</>}
			</div>
		</div>
	</div>;
}

function FlashcardRound({ active, topics, command, busy }: { active: NonNullable<Snapshot["active"]>; topics: Snapshot["topics"]; command: Command; busy: boolean }) {
	const { session, attempt } = active;
	const [answer, setAnswer] = useState(attempt.answer ?? "");
	const heading = useRef<HTMLHeadingElement>(null);
	const gradedAt = attempt.assessment?.gradedAt;
	useEffect(() => { if (gradedAt) heading.current?.focus(); }, [gradedAt]);
	const body = { sessionId: session.id, attemptId: attempt.id };
	return <section className="mx-auto max-w-3xl py-4" aria-labelledby="flashcard-question-heading">
		<p className="text-sm text-muted-foreground">Card {session.index + 1} of {session.cardIds.length} · {topics.find(t => t.id === attempt.card.topicId)?.name}</p>
		<h1 id="flashcard-question-heading" ref={heading} tabIndex={-1} className="mb-6 mt-3 text-2xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring">{attempt.assessment ? "Review your answer" : "Recall in your own words"}</h1>
		<div className="mb-6 break-words text-base leading-relaxed"><MessageResponse>{attempt.card.question}</MessageResponse></div>
		{!attempt.assessment ? <form className="space-y-5" onSubmit={async e => { e.preventDefault(); await command({ action: "answer", ...body, answer: attempt.answer ?? answer }); }}>
			<label htmlFor="flashcard-answer" className="grid gap-2 text-sm">Your answer<Textarea id="flashcard-answer" name="answer" rows={6} maxLength={16000} required autoFocus readOnly={!!attempt.submittedAt} value={attempt.answer ?? answer} onChange={e => setAnswer(e.target.value)} className="min-h-40" /></label>
			{attempt.submittedAt && <p role="status" className="text-sm text-muted-foreground">Your answer is saved. {busy ? "The tutor is assessing it…" : "Retry assessment to receive feedback."}</p>}
			<div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || !(attempt.answer ?? answer).trim()}>{busy ? "Assessing answer…" : attempt.submittedAt ? "Retry assessment" : "Submit answer"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void command({ action: "end", ...body })}>End round</Button></div>
		</form> : <div className="space-y-6">
			<div><h2 className="mb-2 text-sm font-medium">Your answer</h2><p className="whitespace-pre-wrap break-words text-base leading-relaxed">{attempt.answer}</p></div>
			<div className="border-y border-border py-5"><p role="status" className="mb-3 font-semibold">{attempt.assessment.outcome === "correct" ? "Correct" : attempt.assessment.outcome === "partial" ? "Partly correct" : "Needs more practice"}</p><MessageResponse>{attempt.assessment.feedback}</MessageResponse></div>
			<div><h2 className="mb-3 text-sm font-medium">Reference answer</h2><MessageResponse>{attempt.solution!}</MessageResponse></div>
			{attempt.criteria && <details><summary className="w-fit cursor-pointer py-2 text-sm">Assessment criteria</summary><MessageResponse>{attempt.criteria}</MessageResponse></details>}
			<div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void command({ action: "next", ...body })}>{session.index + 1 === session.cardIds.length ? "Finish round" : "Next card"}</Button><Button variant="ghost" disabled={busy} onClick={() => void command({ action: "end", ...body })}>End round</Button></div>
		</div>}
	</section>;
}

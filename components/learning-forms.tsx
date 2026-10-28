"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TEACHING_STYLES, type LearningData } from "@/src/core";

export type LearningCommand = (body: Record<string, unknown>) => Promise<unknown | undefined>;
export const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
export const labelClass = "flex min-w-0 flex-col gap-2 text-sm";
export const styleLabels = { adaptive: "Adapt to my progress", "worked-examples": "Worked examples", socratic: "Guided questions", project: "Learn through a project", concise: "Concise explanations" };

export function LearningGoalForm({ command, busy, onCreated }: { command: LearningCommand; busy: boolean; onCreated: (id: string) => void }) {
	const id = useId();
	return <form className="grid max-w-2xl gap-4 py-4" onSubmit={async e => {
		e.preventDefault(); const form = e.currentTarget, fields = new FormData(form);
		const result = await command({ action: "create_goal", title: fields.get("title"), objective: fields.get("objective"), condition: fields.get("condition") });
		if (result) { form.reset(); onCreated((result as { goalId: string }).goalId); }
	}}>
		<label className={labelClass} htmlFor={`${id}-title`}>Learning goal<Input id={`${id}-title`} name="title" required maxLength={160} placeholder="Understand conditional probability" /></label>
		<label className={labelClass} htmlFor={`${id}-objective`}>What should you be able to do?<Textarea id={`${id}-objective`} name="objective" required maxLength={2000} placeholder="Choose the correct denominator and solve an unfamiliar probability problem without hints." /></label>
		<label className={labelClass} htmlFor={`${id}-condition`}>Study method<select id={`${id}-condition`} name="condition" className={selectClass} defaultValue="harness"><option value="harness">LearnHarness</option><option value="ordinary-chat">Ordinary AI chat</option><option value="course">Course or textbook</option></select><span className="text-xs text-muted-foreground">Recorded for comparison. This does not change how your answers are graded.</span></label>
		<Button type="submit" disabled={busy} className="w-fit">Create learning goal</Button>
	</form>;
}

export function LearningCheckForm({ goalId, command, busy }: { goalId: string; command: LearningCommand; busy: boolean }) {
	const id = useId();
	const [mode, setMode] = useState("exact");
	const [saved, setSaved] = useState(false);
	return <form className="grid max-w-2xl gap-4 py-4" onSubmit={async e => {
		e.preventDefault(); const form = e.currentTarget, fields = new FormData(form); setSaved(false);
		const result = await command({ action: "add_check", goalId, prompt: fields.get("prompt"), kind: fields.get("kind"), answerMode: mode,
			answer: fields.get("answer"), tolerance: Number(fields.get("tolerance") || 0), source: fields.get("source"), sourceUrl: fields.get("sourceUrl") || undefined });
		if (result) { form.reset(); setMode("exact"); setSaved(true); }
	}}>
		<label className={labelClass} htmlFor={`${id}-kind`}>What does this question test?<select id={`${id}-kind`} name="kind" className={selectClass}><option value="recall">Recall and understanding</option><option value="transfer">Independent application</option></select></label>
		<label className={labelClass} htmlFor={`${id}-prompt`}>Question or practical task<Textarea id={`${id}-prompt`} name="prompt" required maxLength={8000} placeholder="Use a different situation from the lesson. State exactly what the answer should contain." /></label>
		<label className={labelClass} htmlFor={`${id}-mode`}>How to check the answer<select id={`${id}-mode`} className={selectClass} value={mode} onChange={e => setMode(e.target.value)}><option value="exact">Exact answer (case-sensitive)</option><option value="numeric">Number (absolute tolerance)</option><option value="rubric">Rubric / project criteria (self-assessed)</option></select></label>
		<label className={labelClass} htmlFor={`${id}-answer`}>{mode === "rubric" ? "Observable acceptance criteria" : "Expected answer"}<Textarea id={`${id}-answer`} name="answer" required maxLength={8000} /><span className="text-xs text-muted-foreground">{mode === "exact" ? "Only surrounding and repeated whitespace is ignored. Use a rubric for equivalent explanations." : mode === "numeric" ? "Enter one decimal or scientific number without units. State required units in the question." : "List concrete criteria or tests that a reviewer can inspect. Self-ratings do not establish demonstrated or retained status."}</span></label>
		{mode === "numeric" && <label className={labelClass} htmlFor={`${id}-tolerance`}>Absolute tolerance<Input id={`${id}-tolerance`} name="tolerance" type="number" min="0" step="any" defaultValue="0" required /></label>}
		<label className={labelClass} htmlFor={`${id}-source`}>Reference and exact location<Input id={`${id}-source`} name="source" required maxLength={2000} placeholder="Book title, chapter and page; or specification section" /></label>
		<label className={labelClass} htmlFor={`${id}-url`}>Reference URL (optional)<Input id={`${id}-url`} name="sourceUrl" type="url" maxLength={2000} placeholder="https://…" /></label>
		<p className="text-sm text-muted-foreground">Save the question, then inspect and confirm its answer key against the reference. Future attempts keep their original key.</p>
		<Button type="submit" disabled={busy} className="w-fit">Save review question</Button>
		{saved && <p role="status" className="text-sm">Question saved. Check its answer key below before reviewing.</p>}
	</form>;
}

export function LearningPreferences({ preferences, command, busy }: { preferences: LearningData["preferences"]; command: LearningCommand; busy: boolean }) {
	const id = useId();
	const [saved, setSaved] = useState(false);
	return <details className="border-t border-border py-5">
		<summary className="w-fit cursor-pointer py-1 text-sm font-medium">Teaching preferences</summary>
		<form key={JSON.stringify(preferences)} className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2" onSubmit={async e => {
			e.preventDefault(); const fields = new FormData(e.currentTarget); setSaved(false);
			if (await command({ action: "preferences", style: fields.get("style"), sessionMinutes: Number(fields.get("minutes")) })) setSaved(true);
		}}>
			<label className={labelClass} htmlFor={`${id}-style`}>Preferred approach<select id={`${id}-style`} name="style" className={selectClass} defaultValue={preferences.style}>{TEACHING_STYLES.map(s => <option key={s} value={s}>{styleLabels[s]}</option>)}</select></label>
			<label className={labelClass} htmlFor={`${id}-minutes`}>Session budget (minutes)<Input id={`${id}-minutes`} name="minutes" type="number" min="5" max="120" step="1" required defaultValue={preferences.sessionMinutes} /></label>
			<p className="text-sm text-muted-foreground sm:col-span-2">Used from the next tutor turn. You can change the approach in conversation at any time.</p>
			<Button type="submit" disabled={busy} variant="outline" className="w-fit">Save preferences</Button>
			{saved && <p role="status" className="text-sm">Preferences saved.</p>}
		</form>
	</details>;
}

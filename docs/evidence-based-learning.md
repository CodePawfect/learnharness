# Evidence-based learning — CodePawfect fork

## Automatic flashcards

**Flashcards** in the sidebar is a separate, immediately usable study library. On its first visit, it processes existing teaching and practice sessions. Subsequent settled tutor turns enqueue new material automatically. Each source session is read in full, including attributed learner prose and practice thinking; pending practice solutions are excluded. The tutor proposes cards only for sections with actual teaching, a learner attempt, and subsequent substantive feedback. Diagnostic-only exchanges, skipped checks, unresolved follow-ups, and explanations still awaiting their check stay deferred. A partially completed path can already supply cards from its completed sections. This classification is a model judgment, constrained by validated chronological message citations, rather than a guarantee of teaching quality.

Topics and semantic card identities are reused across sessions. Full-session fingerprints avoid repeated work, output pagination handles more than one batch of cards, and the queue discards results if the source changes while it is being interpreted. Failed processing leaves its checkpoint untouched. Retry using **Check lessons** / **Retry lesson processing**; unfinished sections are reconsidered when the transcript changes. A session that exceeds the configured tutor's context window remains pending with an explicit error instead of silently dropping content. Later corrections can update a card while preserving historical attempt snapshots; a changed reference reopens its review schedule.

Choose one or several topics and a total card count. Rounds interleave selected topics, prefer due and difficult cards, and never repeat a card within a round. Submit a free-text answer before the reference becomes available. The configured conversation tutor assesses it as correct, partly correct, or needing more practice, with feedback and the reference answer. The submitted answer is committed before the model call; a connection failure preserves it for retry. Rounds and assessments survive reloads and restarts. A canceled round does not invent grades for its unanswered cards.

`flashcards.json` is an independent, versioned, locked, atomically replaced local file alongside `learning.json`. Back it up with the other learning data. Tutor assessments drive a per-card 1, 3, 7, 14, 30, 60 day heuristic; early correct practice cannot push away an earlier review. These model assessments do **not** create independently checked Review evidence or mastery labels. The existing Review workflow and its explicit key-verification policy are unchanged. Cards need no approval and have no generation badge.

Generation uses the session's configured conversation model and respects subscription background-access consent. Assessment uses that same configuration, falling back to the current strong slot only when the source session is unavailable. Usage is recorded on surviving source sessions. No notifications or scheduled unattended lessons are created. The serial queue and in-flight assessments live only for the server lifetime; saved cards, submitted answers, and completed-session fingerprints remain durable. After a restart, opening Flashcards resumes pending source processing, and a saved ungraded answer offers **Retry assessment**. Corrupt or future-version files are preserved and reported, never replaced with an empty history. A stale `flashcards.lock` after an abnormal process termination requires the same stop-all-writers, back-up, and scoped-lock-removal procedure described below for `learning.lock`.

Regression coverage includes source citations, unrevealed solution exclusion, practice thinking, cross-session deduplication, interrupted backfill, stale-source rejection, concurrent grading retries, immutable historical keys, scheduling, malformed data, and lock/write failure. After a production build, `node scripts/smoke-flashcards.mjs /absolute/artifact-directory` runs the actual browser → API → subscription/model transport → file → restored UI path using synthetic credentials and an offline SSE tutor fixture. It exercises mixed rounds, pending sections, failed assessments, reload recovery, and 320/390/768/1366/1440 px widths; it removes its server, profile and data afterward. This establishes integration behavior, not live-model grading accuracy or educational effectiveness.

## User workflow

Open **Review** in the sidebar. Create a measurable learning goal or ask the tutor to propose one with recall and application questions. Inspect each proposed answer key and its exact source, then confirm that you checked them. The app records this confirmation; it cannot establish that a reference is true merely because a URL was entered.

Start a due review. Commit your answer before seeing the solution, and declare any notes, hints, or outside help. Exact answers are case-sensitive after whitespace normalization. Numeric answers accept decimal/scientific notation with an explicit absolute tolerance; units belong in the question, not the numeric answer. A rubric supports explanations, projects, and practical acceptance tests; its result is explicitly self-assessed.

Opening a solution or inspecting the question bank during an active review permanently marks that attempt as assisted, including across browser tabs. Reviewing an already learned item is expected; this is a personal study tool, not a proctored examination or an anti-cheating system. The app does not execute learner code or arbitrary shell commands. For a programming project, put the independently runnable acceptance tests in the rubric and report their actual result as self-assessment.

Incorrect or ambiguous keys should be retired and replaced. Completed attempts keep an immutable snapshot of the old key, source, review confirmation, and study condition so a later edit cannot rewrite the evidence. Archived goals preserve their history and can be restored.

## Evidence and scheduling

The content graph stays a map of taught material. `learning.json` stores goals, questions, attempts, learner-attributed tutor observations, and teaching preferences separately.

| State | Required evidence |
| --- | --- |
| Not assessed | No completed review or tutor observation |
| Practiced | An attempt or attributed tutor observation |
| Demonstrated | Unaided correct answers against learner-checked deterministic keys on distinct questions, including an application at least 24 hours after the first pass |
| Retained | The demonstrated criteria, plus a later unaided correct retrieval at least seven days after the first pass |

These are conservative product labels, not certified mastery. A later wrong, assisted, or self-assessed attempt reopens the question of independently demonstrated performance. Confidence is stored as self-report and does not raise the state. Due reviews remain visible even when historical evidence says retained.

The deterministic scheduler uses 1, 3, 7, 14, 30, and 60 day intervals. A due unaided checked pass advances the interval. Failure, assistance, or self-assessment shortens it. Early extra practice never postpones an earlier scheduled review and cannot inflate the interval. Queue selection interleaves goals and prefers less-used questions, alternating recall/application on ties. Add fresh variants to avoid memorizing a fixed surface. This is an inspectable heuristic, not FSRS or an empirically fitted forgetting curve.

Scheduling means a due queue inside the application. No operating-system notification, Codex automation, background email, or unattended model call is created. All times are persisted as UTC and displayed in the browser's local timezone. The open Review page refreshes due state once per minute while visible; ordinary data changes use the existing SSE event channel.

## Integration

- `src/core/learning.ts`: validated commands, deterministic grading, state derivation, queue selection, public projections, and descriptive evaluation. No IO or model dependencies.
- `src/store/learning.ts`: `LearningStore`, versioned JSON under `PATHS.data`, atomic replacement, exclusive write lock, notifications after successful writes.
- `src/server/learning.ts` / `/api/learning`: browser commands, snapshot, explicit evidence export. The existing API access proxy applies.
- `src/agent/tools/learning.ts`: read evidence, propose unverified goals/questions, and record judgments tied to exact persisted learner quotes. The model cannot confirm keys, submit independent answers, or change the computed schedule.
- `components/learning-*.tsx` / `/review`: due queue, questions, blind attempts, verification, evidence, preferences, and export. Existing tokens, controls, sidebar, and TopBar are reused.

The prober, teacher, and practice agent share the evidence policy. Attributed observations can quote actual learner prose from normal chat, free-text answers (`explain`/`recall` and `ask_user_question`), quiz/probe thinking, reading notes, and practice thinking, including notes attached to a skipped question. Option labels, question text, tutor explanations, committed solutions, failed tool calls, and arbitrary tool output are not learner quotes. A skip makes no performance claim; its attached questions still reach the tutor. Existing saved dismissals recover reading notes from their stored details on replay without a disk migration.

Every tutor turn automatically receives a bounded, answer-key-free snapshot of preferences, up to ten active goals (current-chat goals first), and the eight most recent active-goal observations. Objective excerpts are capped at 240 characters; quote and note excerpts at 400 each, explicitly labeled when shortened. Counts expose omitted history. `learning_status` retrieves full observations five at a time with `goalId`/`observationOffset`; goals are paged in batches of 100 with `goalOffset`. Returned next offsets identify further pages. Archiving a goal excludes it from this active teaching context while preserving the history.

The tutor is instructed to answer concrete follow-ups before advancing, record relevant evidence for agreed goals before posing another question, and append new evidence when an earlier diagnosis is corrected. Storage and context delivery are deterministic; the quality and completeness of a live model's judgments and tool use still require evaluation. Enabled user prompt overrides continue to replace their source fragments and should be reviewed separately if they retain older instructions.

Compaction serializes learner answers and follow-up notes in full, separately from bounded generic tool output. Its summary instructions preserve unresolved questions and later corrections. Summary generation itself remains a model operation.

The learning tools are added at the conversation composition boundary; explicit test registries remain authoritative. Preferences are read afresh each turn. A newer request in conversation takes precedence over saved preferences. A corrupt optional learning file does not prevent an otherwise valid teaching conversation; Review reports the error and the tutor avoids claiming persisted mastery.

## Persistence, recovery, and privacy

An absent learning file means a new empty history. A malformed or unsupported future-version file fails closed and is preserved. Updates write a private temporary file, flush it, and rename it over the record. Rejected updates do not replace the original. The write lock prevents two processes from overwriting each other's changes; there is no automatic speculative stale-lock removal.

If a process is killed during a write and `learning.lock` remains: stop all app/server instances using that data directory, back up `learning.json`, remove only `learning.lock` and task-owned abandoned `learning.json.*.tmp` files, then restart. Never remove the lock while a writer may still be active. The original JSON remains intact or the complete new version has landed.

Back up `learning.json` with the rest of the data directory. Export includes learner answers, quotations, goal names, source URLs, and answer keys; treat it as personal data. No credentials are included. Tutoring sends selected evidence through the configured model provider, just as conversation context already does. The standalone Review workflow and evaluation script make no model requests.

Learning observations retain their evidence quote even if the source chat is later deleted; the source link may then be unavailable. Archiving a goal preserves all evidence. No automatic backfill marks old conversations as learned. Existing graph/chats/settings formats do not migrate.

## Verification and limitations

Regression tests also cover skipped-question notes on the provider wire, replay of older dismissals, learner-only quote attribution, persistence across a reopened store, automatic context injection, and retrieval of older observation pages without answer keys. Tests cover deterministic grading, delayed and distinct-task requirements, hint contamination, immutable keys, replay-safe attempt submission, queue selection, interleaving, failed writes, lock contention, malformed data, and learner-quote attribution. The report script can reproduce outcome summaries without a provider connection.

The isolated browser smoke test (`node scripts/smoke-learning.mjs /absolute/artifact-directory`) exercises actual Review UI → API → disk → restored UI with synthetic arithmetic data. It covers source/key confirmation, a blind answer, grading, assisted practice, duplicate submission, preferences, invalid requests, evidence export, 320/390/768/1280/1440 px layouts, and keyboard activation with visible focus in the supported dark theme. It owns and removes its local server, browser profile, and synthetic data. Screenshots and logs are saved only in the explicitly chosen artifact directory. A screen-reader audit and live-model teaching session are not covered by this smoke test.

These checks establish software behavior, not educational effectiveness. Live model adherence, reference correctness, broader transfer, and long-term learning gains require further evaluation. The current automated grading covers exact and numeric answers; open-ended work is transparently self-assessed. The learning record is a small synchronous local file; a large deployment would need an indexed storage adapter behind the same port.

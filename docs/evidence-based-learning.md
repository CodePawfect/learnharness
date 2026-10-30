# Evidence-based learning — CodePawfect fork

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

The prober, teacher, and practice agent share the evidence policy. Their concrete tools are added at the conversation composition boundary; explicit test registries remain authoritative. Preferences are read afresh each turn. A newer request in conversation takes precedence over saved preferences. A corrupt optional learning file does not prevent an otherwise valid teaching conversation; Review reports the error and the tutor avoids claiming persisted mastery.

## Persistence, recovery, and privacy

An absent learning file means a new empty history. A malformed or unsupported future-version file fails closed and is preserved. Updates write a private temporary file, flush it, and rename it over the record. Rejected updates do not replace the original. The write lock prevents two processes from overwriting each other's changes; there is no automatic speculative stale-lock removal.

If a process is killed during a write and `learning.lock` remains: stop all app/server instances using that data directory, back up `learning.json`, remove only `learning.lock` and task-owned abandoned `learning.json.*.tmp` files, then restart. Never remove the lock while a writer may still be active. The original JSON remains intact or the complete new version has landed.

Back up `learning.json` with the rest of the data directory. Export includes learner answers, quotations, goal names, source URLs, and answer keys; treat it as personal data. No credentials are included. Tutoring sends selected evidence through the configured model provider, just as conversation context already does. The standalone Review workflow and evaluation script make no model requests.

Learning observations retain their evidence quote even if the source chat is later deleted; the source link may then be unavailable. Archiving a goal preserves all evidence. No automatic backfill marks old conversations as learned. Existing graph/chats/settings formats do not migrate.

## Verification and limitations

Tests cover deterministic grading, delayed and distinct-task requirements, hint contamination, immutable keys, replay-safe attempt submission, queue selection, interleaving, failed writes, lock contention, malformed data, and learner-quote attribution. The report script can reproduce outcome summaries without a provider connection.

The isolated browser smoke test (`node scripts/smoke-learning.mjs /absolute/artifact-directory`) exercises actual Review UI → API → disk → restored UI with synthetic arithmetic data. It covers source/key confirmation, a blind answer, grading, assisted practice, duplicate submission, preferences, invalid requests, evidence export, 320/390/768/1280/1440 px layouts, and keyboard activation with visible focus in the supported dark theme. It owns and removes its local server, browser profile, and synthetic data. Screenshots and logs are saved only in the explicitly chosen artifact directory. A screen-reader audit and live-model teaching session are not covered by this smoke test.

These checks establish software behavior, not educational effectiveness. Live model adherence, reference correctness, broader transfer, and long-term learning gains require further evaluation. The current automated grading covers exact and numeric answers; open-ended work is transparently self-assessed. The learning record is a small synchronous local file; a large deployment would need an indexed storage adapter behind the same port.

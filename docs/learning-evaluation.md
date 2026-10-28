# Delayed-transfer evaluation protocol

The feature can collect evidence; it does not yet establish that LearnHarness improves learning. Report real observations with their sample sizes and limitations. Never publish synthetic test fixtures as learner results.

## Reproducible personal report

1. Give each goal an observable objective and its actual study condition: LearnHarness, ordinary AI chat, or course/textbook. Keep that condition fixed for the goal.
2. Use comparable topics and check prerequisites before studying. Have a knowledgeable reviewer check the references, answer keys, and difficulty. Include multiple task variants and at least one application question.
3. Study and complete an initial assessment. Declare assistance accurately. Record actual study time and provider cost separately; the built-in report measures only elapsed review time, including possible idle time.
4. Return after at least seven days for a different application question without hints. Do not exclude wrong or assisted responses. Retain the original key and document any faulty question separately.
5. Use **Export evidence** in Review after completing the active attempt. Run:

   ```sh
   npm run evaluate:learning -- /absolute/path/to/learnharness-learning-evidence.json
   ```

The script validates the export, makes no network/model calls, and prints JSON. Each condition reports goals, submitted attempts, delayed transfer attempts, unaided delayed-transfer passes, self-assessed attempts, and elapsed review minutes. A delayed transfer requires a reviewed deterministic key, a different question from the goal's first submitted attempt, and at least seven elapsed days. Assisted and incorrect eligible attempts stay in the denominator; only unaided correct answers count in the numerator. No eligible observations means `null`, never 0% or 100%.

This is an observational report. Self-selected conditions, unequal topics, earlier exposure to authoring/verification materials, repeated questions, learner motivation, and prior knowledge can affect it. The current export does not control those confounders or measure broad transfer. Long elapsed review time may include an idle tab; do not present it as active study time.

## Controlled comparison before an effectiveness claim

Pre-register the question, primary measure, participant criteria, allocation procedure, sample-size rationale, study time, delay, allowed assistance, and exclusions before collecting results. Use independent task authors/graders and keep assessment solutions out of the learner's study materials. Counterbalance topic/condition assignments and use comparable parallel forms to reduce topic and practice effects. Keep grading blind to study condition where feasible.

Suggested primary outcome: unaided performance on independently graded, previously unseen application tasks after a fixed delay. Secondary outcomes: delayed recall, calibration, time to capability, active study time, provider cost, and reported burden. Use the same assessment conditions for all arms; an ordinary-chat or textbook comparison must not get an easier or shorter assessment.

Publish errors, missing follow-ups, hint use, invalid questions, and attrition alongside successes. Report uncertainty with methods appropriate to the design; repeated attempts by one learner are not independent participants. Collect consent before sharing personal records. The current software report is a data aid and is not a replacement for this study design.

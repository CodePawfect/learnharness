/** Read-only analysis of an explicit Review export. No model calls, credentials,
 * or network. Usage: npm run evaluate:learning -- /path/to/export.json */
import fs from "node:fs";
import { evaluateLearning, parseLearningData } from "../src/core/learning.ts";

const input = process.argv[2];
if (!input || process.argv.length !== 3) {
	console.error("Usage: npm run evaluate:learning -- /path/to/learnharness-learning-evidence.json");
	process.exitCode = 1;
} else {
	try {
		const data = parseLearningData(JSON.parse(fs.readFileSync(input, "utf8")));
		console.log(JSON.stringify({
			protocol: "learnharness-delayed-transfer-v1",
			interpretation: "Descriptive observations only. Conditions and topics are self-selected; these results do not establish a causal benefit.",
			primaryMeasure: "Unaided correct answers to checked transfer questions at least seven days after the goal's first submitted attempt, on a different question.",
			timeMeasure: "Elapsed review time, including possible idle time. Excludes lesson/study time and provider cost.",
			conditions: evaluateLearning(data),
		}, null, 2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

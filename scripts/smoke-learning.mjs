/** Real browser → API → disk smoke test. Owns an isolated server, Chrome
 * profile, and synthetic data; all processes and data are removed in finally.
 * Run after npm ci: node scripts/smoke-learning.mjs /absolute/artifact-directory */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const artifacts = process.argv[2];
if (!artifacts || !path.isAbsolute(artifacts)) throw new Error("Pass an absolute directory for verification screenshots and logs.");
fs.mkdirSync(artifacts, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-review-smoke-"));
const dataDir = path.join(scratch, "data");
let child, browser, exited, page;
const errors = [];
const log = fs.openSync(path.join(artifacts, "server.log"), "w");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
	const probe = net.createServer();
	await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
	const port = probe.address().port;
	await new Promise(resolve => probe.close(resolve));
	const url = `http://127.0.0.1:${port}`;
	child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
		cwd: root, detached: process.platform !== "win32", stdio: ["ignore", log, log],
		env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", LH_DATA_DIR: dataDir, LH_AUTH_FILE: path.join(scratch, "auth.json"), LH_DESKTOP_SERVER: "", LH_DESKTOP_API_SECRET: "" },
	});
	exited = new Promise(resolve => child.once("exit", resolve));
	let ready = false;
	for (let i = 0; i < 120; i++) {
		if (child.exitCode !== null) throw new Error("Smoke server exited before readiness; see server.log.");
		try { const r = await fetch(`${url}/api/learning`); if (r.ok) { ready = true; break; } } catch { /* starting */ }
		await sleep(500);
	}
	assert.ok(ready, "isolated server ready");
	browser = await puppeteer.launch({
		executablePath: process.env.LH_TEST_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true, userDataDir: path.join(scratch, "chrome"), args: ["--disable-dev-shm-usage"],
	});
	page = await browser.newPage();
	page.on("pageerror", error => errors.push(String(error)));
	await page.setViewport({ width: 1440, height: 1000 });
	await page.evaluateOnNewDocument(() => localStorage.setItem("lh:sidebar-open", "0"));
	await page.goto(`${url}/review`, { waitUntil: "domcontentloaded" });
	const contains = text => page.waitForFunction(t => document.body.innerText.includes(t), {}, text);
	const click = async (label, selector = "button") => {
		const elements = await page.$$(selector);
		for (const element of elements) {
			if ((await element.evaluate(el => el.textContent.trim())) === label) { await element.click(); return; }
		}
		throw new Error(`Missing ${selector}: ${label}`);
	};
	const fill = async (selector, text) => {
		await page.locator(selector).fill(text);
	};
	const api = (action, payload = {}) => page.evaluate(async (action, payload) => {
		const res = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
		return { status: res.status, body: await res.json() };
	}, action, payload);
	await contains("Create learning goal");
	const theme = await page.evaluate(async () => {
		await document.fonts.ready;
		return { background: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily,
			loaded: document.fonts.check('16px "Hack Nerd Font"', 'Äöß \uf120') };
	});
	assert.equal(theme.background, "rgb(35, 33, 54)");
	assert.ok(theme.font.includes("Hack Nerd Font") && theme.loaded, "real bundled Hack font loaded");
	await page.screenshot({ path: path.join(artifacts, "review-empty-desktop.png") });
	await fill('[name="title"]', "Apply multiplication — synthetic test");
	await fill('[name="objective"]', "Find totals in unfamiliar grouping problems without hints.");
	await click("Create learning goal");
	await contains("Add a review question");
	await click("Add a review question", "summary");
	await fill('[name="prompt"]', "Six boxes each contain seven tiles. How many tiles are there? Enter a number.");
	await page.select('select[id$="-mode"]', "numeric");
	await fill('[name="answer"]', "42");
	await fill('[name="source"]', "Synthetic arithmetic fixture: six groups of seven, independently calculated as 42.");
	await click("Save review question");
	await contains("Key needs checking");
	await click("Check answer key");
	await contains("I checked the question and answer");
	const label = await page.$('section[aria-label="Answer key verification"] input[type="checkbox"]');
	await label.click(); await click("Confirm checked key");
	await contains("Key checked by you");
	await click("Add a review question", "summary");
	await page.screenshot({ path: path.join(artifacts, "review-goal-desktop.png") });
	await click("Start due review");
	await contains("Try it without help");
	const blind = await page.evaluate(async () => (await fetch("/api/learning")).json());
	assert.ok(blind.active && !blind.active.solution && !("answer" in blind.active.check));
	await fill('textarea[name="answer"]', "42");
	await page.screenshot({ path: path.join(artifacts, "review-attempt-desktop.png") });
	await click("Submit answer");
	await contains("Checked against your reviewed answer key");
	await contains("Committed answer key");
	await page.screenshot({ path: path.join(artifacts, "review-result-desktop.png") });
	let stored = JSON.parse(fs.readFileSync(path.join(dataDir, "learning.json"), "utf8"));
	assert.equal(stored.attempts.length, 1); assert.equal(stored.attempts[0].outcome, "correct");
	assert.equal(stored.attempts[0].assisted, false); assert.equal(stored.attempts[0].answer, "42");
	await click("Back to review queue");
	await page.reload({ waitUntil: "domcontentloaded" });
	await contains("1 unaided checked pass");
	const status = await page.evaluate(async () => (await fetch("/api/learning")).json());
	assert.equal(status.dueCount, 0);
	await click("Extra practice"); await contains("Try it without help");
	await click("Show solution"); await contains("assisted practice");
	await fill('textarea[name="answer"]', "42"); await click("Submit answer"); await contains("Assisted");
	stored = JSON.parse(fs.readFileSync(path.join(dataDir, "learning.json"), "utf8"));
	assert.equal(stored.attempts[1].assisted, true);
	const duplicate = await api("submit_answer", { attemptId: stored.attempts[1].id, answer: "42", assisted: false });
	assert.equal(duplicate.status, 200); assert.equal(duplicate.body.result.assisted, true);
	assert.equal(duplicate.body.snapshot.attempts.length, 2);
	await click("Back to review queue");
	await click("Teaching preferences", "summary");
	await page.select('select[name="style"]', "worked-examples");
	await fill('input[name="minutes"]', "15"); await click("Save preferences"); await contains("Preferences saved.");
	stored = JSON.parse(fs.readFileSync(path.join(dataDir, "learning.json"), "utf8"));
	assert.deepEqual(stored.preferences, { style: "worked-examples", sessionMinutes: 15 });
	assert.equal((await api("add_check", { goalId: stored.goals[0].id, prompt: "Invalid question", kind: "recall", answerMode: "numeric", answer: "NaN", source: "synthetic" })).status, 400);
	assert.equal((await api("export")).body.evaluation[0].unaidedDelayedTransferRate, null);
	const narrowWidths = [1280, 768, 390, 320];
	for (const width of narrowWidths) {
		await page.setViewport({ width, height: width >= 1000 ? 720 : 844 });
		await page.evaluate(() => { document.querySelector("[data-review-scroll]").scrollTop = 0; window.scrollTo(0, 0); });
		await sleep(150);
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
		assert.equal(overflow, false, `no horizontal overflow at ${width}`);
		await page.screenshot({ path: path.join(artifacts, `review-${width}-dark.png`) });
	}
	await page.setViewport({ width: 1440, height: 1000 });
	// Keyboard traversal must reach the real action without a trap.
	await page.focus('a[href="/chat/new"]');
	await page.keyboard.press("Tab");
	assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), "Add learning goal");
	assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "solid");
	await page.keyboard.press("Enter");
	await page.waitForSelector('input[name="title"]');

	// Exercise actual markdown rendering, including themed code, emphasis and diagrams.
	const demo = await api("create_goal", { title: "Bayes verstehen — Theme-Vorschau", objective: "Wahrscheinlichkeiten begründen und auf neue Situationen anwenden." });
	const demoGoal = demo.body.result.goalId;
	const richPrompt = "## Verstehen, anwenden, behalten\n\n**Ein klarer Gedanke:** Neues Wissen wird durch Anwendung überprüft. _Ein Schritt nach dem anderen._\n\n> [!IMPORTANT]\n> Erkläre deine Überlegung und prüfe sie an einem neuen Beispiel.\n\n```ts\nconst lernziel = { thema: \"Bayes\", verstanden: true };\n```\n\n```mermaid\ngraph LR\n  A[Verstehen] --> B[Anwenden] --> C[Wiederholen]\n```\n\nWie würdest du deinen Lösungsweg überprüfen?";
	const demoCheck = await api("add_check", { goalId: demoGoal, prompt: richPrompt, kind: "transfer", answerMode: "rubric", answer: "Begründe die Annahmen und prüfe ein unabhängiges Beispiel.", source: "Synthetic theme-preview fixture; no learner assessment." });
	await api("approve_key", { checkId: demoCheck.body.result.checkId, confirmed: true });
	await api("start_review", { goalId: demoGoal });
	await page.goto(`${url}/review`, { waitUntil: "domcontentloaded" });
	await contains("Verstehen, anwenden, behalten");
	await page.waitForSelector('svg[aria-roledescription="flowchart-v2"], [data-testid="md-mermaid"] svg', { timeout: 30000 });
	await page.evaluate(async () => {
		await Promise.all(['16px "Hack Nerd Font"', '700 16px "Hack Nerd Font"', 'italic 16px "Hack Nerd Font"', 'italic 700 16px "Hack Nerd Font"'].map(font => document.fonts.load(font)));
	});
	assert.ok((await page.$eval(".lh-prose", el => getComputedStyle(el).fontFamily)).includes("Hack Nerd Font"));
	const session = await page.createCDPSession();
	await session.send("DOM.enable"); await session.send("CSS.enable");
	const documentNode = await session.send("DOM.getDocument");
	const paragraph = await session.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: ".lh-prose p" });
	const platformFonts = await session.send("CSS.getPlatformFontsForNode", { nodeId: paragraph.nodeId });
	assert.ok(platformFonts.fonts.some(font => font.familyName.includes("Hack") && font.isCustomFont), "Chrome is drawing with the bundled font, not a fallback");
	await page.screenshot({ path: path.join(artifacts, "rose-pine-moon-learning.png") });
	await page.goto(`${url}/chat/new`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector('[data-testid="setup-cta"], textarea');
	await page.screenshot({ path: path.join(artifacts, "rose-pine-moon-new-session.png") });
	await page.click('[aria-label="Open sidebar"]');
	await page.waitForFunction(() => document.querySelector("aside")?.getBoundingClientRect().width >= 280);
	await page.click('[data-testid="settings-entry"]');
	await page.waitForSelector('[data-testid="settings-nav-appearance"]', { visible: true });
	await page.click('[data-testid="settings-nav-appearance"]');
	await contains("Hack Nerd Font");
	await page.screenshot({ path: path.join(artifacts, "rose-pine-moon-settings.png") });
	assert.deepEqual(errors, [], "no browser runtime errors");
	fs.writeFileSync(path.join(artifacts, "result.json"), JSON.stringify({
		passed: true, syntheticData: true, browser: await browser.version(), viewports: [1440, ...narrowWidths],
		theme,
		checks: ["bundled Hack font and Moon palette", "goal creation", "question creation", "source/key confirmation", "blind answer", "deterministic grading", "disk persistence", "reload", "hint contamination", "idempotent submission", "preferences", "invalid input", "evaluation export", "responsive widths", "supported dark theme", "keyboard activation and visible focus", "browser runtime errors"],
	}, null, 2));
	console.log("PASS: Review UI → API → isolated disk → restored UI. Screenshots and result.json saved.");
} catch (error) {
	if (page && !page.isClosed()) {
		await page.screenshot({ path: path.join(artifacts, "failure.png") }).catch(() => {});
		const diagnostics = await page.evaluate(() => ({ text: document.body.innerText, fields: [...document.querySelectorAll("input, textarea, select")].map(el => ({ name: el.name, value: el.value, valid: el.checkValidity() })) })).catch(() => ({}));
		fs.writeFileSync(path.join(artifacts, "failure.json"), JSON.stringify({ error: String(error), errors, ...diagnostics }, null, 2));
	}
	throw error;
} finally {
	if (browser) await browser.close();
	if (child && child.exitCode === null) {
		try { if (process.platform === "win32") child.kill("SIGTERM"); else process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
		await Promise.race([exited, sleep(5000)]);
		if (child.exitCode === null) { try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } await exited; }
	}
	fs.closeSync(log);
	fs.rmSync(scratch, { recursive: true, force: true });
	console.log("Cleanup: isolated server, browser profile, and synthetic learning data removed.");
}

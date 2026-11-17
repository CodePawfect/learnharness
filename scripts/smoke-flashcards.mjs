/** Browser → production API → real model transport (offline SSE fixture) → disk.
 * Run after npm run build: node scripts/smoke-flashcards.mjs /absolute/artifacts.
 * Owns and removes its server, browser profile, synthetic credentials and data. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { createModels, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const root = path.resolve(import.meta.dirname, ".."), artifacts = process.argv[2];
if (!artifacts || !path.isAbsolute(artifacts)) throw new Error("Pass an absolute artifact directory.");
fs.mkdirSync(artifacts, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-flashcards-smoke-"));
const dataDir = path.join(scratch, "data"); fs.mkdirSync(path.join(dataDir, "chats"), { recursive: true });
const require = createRequire(import.meta.url), { SCOPES } = require("../electron/chatgpt.cjs");
const models = createModels(); for (const p of builtinProviders()) models.setProvider(p);
const model = models.getModels("openai").find(m => m.api === "openai-responses"); assert(model);
const now = new Date().toISOString();
const teacher = (id, text) => ({ ...fauxAssistantMessage(text), id });
for (const [id, title] of [["tls", "TLS"], ["docker", "Docker"], ["pending", "Pending lesson"]]) {
	const messages = [teacher(`teach_${id}`, `${title}: completed explanation of a central concept. What does it mean?`),
		{ id: `learner_${id}`, role: "user", content: "My independent answer.", timestamp: Date.now() },
		...(id === "pending" ? [] : [teacher(`feedback_${id}`, "Correct; this section is complete. Now a new topic is still open.")])];
	fs.writeFileSync(path.join(dataDir, "chats", `${id}.json`), JSON.stringify({ version: 1, id, title, createdAt: now, updatedAt: now, messages }));
}
fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ version: 1, graph: { enabled: false }, models: { strong: { model: { provider: "chatgpt", id: model.id }, thinkingLevel: "off" } } }));
fs.writeFileSync(path.join(scratch, "auth.json"), "{}");
fs.writeFileSync(path.join(scratch, "chatgpt-credentials.json"), JSON.stringify({ version: 1, hostId: "offline-host", allowBackgroundUse: true, activeId: "offline-account", registrations: [{ id: "offline-account", clientId: "oaiapp_fixture", issuer: "https://auth.openai.com", subject: "offline-subject", email: "fixture@example.invalid", tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh", idToken: "fixture-id", scopes: SCOPES, expiresAt: Date.now() + 3600000 } }] }), { mode: 0o600 });
const preload = path.join(scratch, "offline-fetch.mjs");
fs.writeFileSync(preload, `import fs from 'node:fs';
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
 const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
 if (['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return original(input, init);
 if (url.href === 'https://api.openai.com/v1/models') return Response.json({models:[{slug:${JSON.stringify(model.id)},display_name:'Offline tutor',visibility:'list'}]});
 if (url.href !== 'https://api.openai.com/v1/responses') throw new Error('Offline smoke forbids external traffic: '+url.origin+url.pathname);
 const body = JSON.parse(init.body);
 const raw = body.input.filter(m=>m.role==='user').at(-1)?.content;
 const prompt = JSON.parse(typeof raw==='string'?raw:raw.map(c=>c.text||'').join(''));
 const grading = 'learnerAnswer' in prompt;
 if (grading && prompt.learnerAnswer==='NETWORK_FAILURE') return new Response('Synthetic outage',{status:503});
 let result;
 if (grading) result={outcome:prompt.learnerAnswer.includes('partial')?'partial':prompt.learnerAnswer.includes('wrong')?'incorrect':'correct',feedback:'Your answer was checked against the committed criteria. Explain the essential distinction clearly.'};
 else {
  const id=prompt.sessionId;
  result={deferred:true,moreReady:false,cards:id==='pending'?[]:[{topic:id==='tls'?'TLS':'Docker',concept:id==='tls'?'transport protection':'image versus container',question:id==='tls'?'What does TLS protect, and how is the server authenticated?':'How does a container differ from an image?',answer:id==='tls'?'TLS encrypts data in transit; certificates authenticate the server.':'An image is a reusable template; a container is a running instance.',criteria:'Explain both parts of the distinction.',teachingMessageId:'teach_'+id,learnerMessageId:'learner_'+id,feedbackMessageId:'feedback_'+id}]};
 }
 fs.appendFileSync(${JSON.stringify(path.join(scratch, "calls.jsonl"))},JSON.stringify({grading,sessionId:prompt.sessionId})+'\\n');
 const name=grading?'submit_assessment':'submit_flashcards',args=JSON.stringify(result),id='call_'+Date.now();
 const item={id:'fc_'+id,type:'function_call',call_id:id,name,namespace:'learnharness',arguments:args};
 const response={id:'resp_'+id,object:'response',status:'completed',model:body.model,output:[item],usage:{input_tokens:100,output_tokens:100,total_tokens:200}};
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,arguments:''}},{type:'response.function_call_arguments.delta',output_index:0,item_id:item.id,delta:args},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 return new Response(events.map(e=>'event: '+e.type+'\\ndata: '+JSON.stringify(e)+'\\n\\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
};`, { mode: 0o600 });

const log = fs.openSync(path.join(artifacts, "server.log"), "w");
let child, browser, exited;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
	const socket = net.createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
	const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
	const url = `http://127.0.0.1:${port}`;
	child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
		cwd: root, detached: true, stdio: ["ignore", log, log], env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", LH_DATA_DIR: dataDir, LH_AUTH_FILE: path.join(scratch, "auth.json"), LH_DESKTOP_SERVER: "", LH_DESKTOP_API_SECRET: "", LH_IGNORE_ENV_KEYS: "1", NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
	});
	exited = new Promise(resolve => child.once("exit", resolve));
	let ready = false;
	for (let i = 0; i < 100; i++) {
		if (child.exitCode !== null) throw new Error("Smoke server exited; see server.log.");
		try { if ((await fetch(`${url}/api/flashcards`)).ok) { ready = true; break; } } catch { /* starting */ }
		await sleep(300);
	}
	assert(ready, "production server ready");
	browser = await puppeteer.launch({ executablePath: process.env.LH_TEST_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, userDataDir: path.join(scratch, "chrome"), args: ["--disable-dev-shm-usage"] });
	const page = await browser.newPage(), errors = [];
	page.on("pageerror", e => errors.push(String(e)));
	await page.evaluateOnNewDocument(() => localStorage.setItem("lh:sidebar-open", "0"));
	await page.setViewport({ width: 1440, height: 900 });
	await page.goto(`${url}/flashcards`, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(() => document.body.innerText.includes("3 sessions checked"), { timeout: 45000 });
	let stored = JSON.parse(fs.readFileSync(path.join(dataDir, "flashcards.json"), "utf8"));
	assert.equal(stored.cards.length, 2); assert.equal(stored.checkpoints.length, 3);
	assert(stored.checkpoints.find(c => c.chatId === "pending").deferred);
	const api = body => page.evaluate(async body => { const r = await fetch("/api/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }, body);
	const snapshot = () => page.evaluate(async () => (await fetch("/api/flashcards")).json());
	const click = async label => {
		for (const b of await page.$$("button")) if ((await b.evaluate(el => el.textContent.trim())) === label) { await b.click(); return; }
		throw new Error(`Missing button ${label}`);
	};
	for (const checkbox of await page.$$('input[type="checkbox"]')) await checkbox.click();
	await page.locator('[name="count"]').fill("2");
	for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1366, 768], [1440, 900]]) {
		await page.setViewport({ width, height });
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}`);
		await page.screenshot({ path: path.join(artifacts, `topics-${width}.png`), fullPage: true });
	}
	await click("Start learning"); await page.waitForSelector('[name="answer"]');
	let state = await snapshot(); assert(!("solution" in state.active.attempt));
	assert.equal(state.active.session.cardIds.length, 2);
	await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector('[name="answer"]');
	assert.equal((await snapshot()).active.session.id, state.active.session.id, "round survives reload");
	await page.locator('[name="answer"]').fill("NETWORK_FAILURE"); await click("Submit answer");
	await page.waitForFunction(() => document.body.innerText.includes("Retry assessment"), { timeout: 15000 });
	assert.equal((await snapshot()).active.attempt.answer, "NETWORK_FAILURE");
	await page.screenshot({ path: path.join(artifacts, "assessment-recovery.png") });
	await click("End round"); await page.waitForSelector('[name="count"]');
	for (const checkbox of await page.$$('input[type="checkbox"]')) if (!(await checkbox.evaluate(el => el.checked))) await checkbox.click();
	await page.locator('[name="count"]').fill("2"); await click("Start learning"); await page.waitForSelector('[name="answer"]');
	await page.locator('[name="answer"]').fill("A partial explanation"); await click("Submit answer");
	await page.waitForFunction(() => document.body.innerText.includes("Partly correct"), { timeout: 15000 });
	state = await snapshot(); assert(state.active.attempt.solution);
	await page.screenshot({ path: path.join(artifacts, "assessment-desktop.png"), fullPage: true });
	await page.setViewport({ width: 390, height: 844 });
	await page.screenshot({ path: path.join(artifacts, "assessment-phone.png"), fullPage: true });
	await click("Next card"); await page.waitForSelector('[name="answer"]');
	await page.locator('[name="answer"]').fill("A complete explanation"); await click("Submit answer");
	await page.waitForFunction(() => document.body.innerText.includes("Reference answer"), { timeout: 15000 });
	await click("Finish round"); await page.waitForSelector('[name="count"]');
	assert.match(await page.evaluate(() => document.body.innerText), /2 of 2 cards reviewed/);
	const countBefore = JSON.parse(fs.readFileSync(path.join(dataDir, "flashcards.json"), "utf8")).cards.length;
	await click("Check lessons"); await sleep(300);
	assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "flashcards.json"), "utf8")).cards.length, countBefore);
	const invalid = await api({ action: "start", requestId: "invalid", topicIds: stored.topics.map(t => t.id), count: 999 }); assert.equal(invalid.status, 400);
	assert.equal(errors.length, 0, errors.join("\n"));
	console.log("Verified: historical extraction, unfinished sections, two-topic mixing, typed assessments, failure recovery, hidden keys, saved rounds, per-card scheduling, duplicate prevention, and five viewport widths.");
} finally {
	if (browser) await browser.close();
	if (child?.exitCode === null) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* exited */ } await Promise.race([exited, sleep(4000)]); if (child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ } await exited; } }
	fs.closeSync(log); fs.rmSync(scratch, { recursive: true, force: true }); assert(!fs.existsSync(scratch));
	console.log("Cleanup verified: isolated server, browser profile, credentials and synthetic data removed.");
}

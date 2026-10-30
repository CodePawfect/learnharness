/** Persistent local launcher. Defaults match the documented storage paths. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/** @param {Record<string, string | undefined>} env */
export function resolveLocalPaths(env = process.env, platform = process.platform, home = os.homedir()) {
	const base = platform === "darwin" ? path.join(home, "Library", "Application Support")
		: platform === "win32" ? (env.APPDATA || path.join(home, "AppData", "Roaming"))
		: (env.XDG_DATA_HOME || path.join(home, ".local", "share"));
	const data = path.resolve(env.LH_DATA_DIR || path.join(base, "LearnHarness"));
	return { data, auth: path.resolve(env.LH_AUTH_FILE || path.join(data, "auth.json")) };
}

function openTarget(target) {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
	const opener = spawn(command, [target], { stdio: "ignore" });
	opener.on("error", () => console.error(`Could not open automatically. Open this location yourself: ${target}`));
}

export function runLocal(args = process.argv.slice(2)) {
	const paths = resolveLocalPaths();
	if (args.includes("--help")) {
		console.log("npm run local                 Start with persistent storage\nnpm run local -- --open-browser  Also open your browser\nnpm run data                  Open your saved-learning folder\nnpm run local -- --show-path   Print its location\nOptional: --port NUMBER; LH_DATA_DIR / LH_AUTH_FILE override storage paths.");
		return;
	}
	if (args.length === 1 && args[0] === "--show-path") { console.log(paths.data); return; }
	if (args.length === 1 && args[0] === "--open-data") {
		fs.mkdirSync(paths.data, { recursive: true }); console.log(`Saved learning: ${paths.data}`); openTarget(paths.data); return;
	}
	let port = 3000, openBrowser = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--open-browser") { openBrowser = true; continue; }
		if (args[i] === "--port" && /^\d+$/.test(args[i + 1] || "")) { port = Number(args[++i]); continue; }
		throw new Error(`Unknown option: ${args[i]}. Run npm run local -- --help.`);
	}
	if (port < 1 || port > 65535) throw new Error("Port must be 1–65535.");
	const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
	const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
	if (!fs.existsSync(next)) throw new Error("Dependencies are missing. Run npm ci once, then npm run local.");
	fs.mkdirSync(paths.data, { recursive: true });
	const url = `http://localhost:${port}`;
	console.log(`\nLearnHarness\nBrowser: ${url}\nSaved learning: ${paths.data}\nOpen saved learning: npm run data\nStop: Ctrl+C (your saved learning stays).\n`);
	const child = spawn(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
		cwd: root, env: { ...process.env, LH_DATA_DIR: paths.data, LH_AUTH_FILE: paths.auth }, stdio: ["inherit", "pipe", "inherit"],
	});
	let opened = false, output = "";
	child.stdout.on("data", chunk => {
		process.stdout.write(chunk);
		output = (output + chunk.toString()).slice(-2000);
		if (openBrowser && !opened && /Ready in/.test(output)) { opened = true; openTarget(url); }
	});
	const stop = signal => { if (child.exitCode === null) child.kill(signal); };
	process.once("SIGINT", () => stop("SIGINT"));
	process.once("SIGTERM", () => stop("SIGTERM"));
	child.once("error", error => { console.error(error.message); process.exitCode = 1; });
	child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 0 : 1); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try { runLocal(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

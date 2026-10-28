import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { resolveLocalPaths } from "../scripts/local.mjs";

test("the easy launcher keeps the previously documented macOS data and key locations", () => {
	const home = "/test-home";
	const data = path.join(home, "Library", "Application Support", "LearnHarness");
	assert.deepEqual(resolveLocalPaths({}, "darwin", home), { data, auth: path.join(data, "auth.json") });
});

test("custom data directories keep their own auth file unless explicitly overridden", () => {
	assert.deepEqual(resolveLocalPaths({ LH_DATA_DIR: "/custom-learning" }, "darwin", "/test-home"), {
		data: path.resolve("/custom-learning"), auth: path.resolve("/custom-learning/auth.json"),
	});
	assert.equal(resolveLocalPaths({ LH_DATA_DIR: "/custom-learning", LH_AUTH_FILE: "/private-keys/auth.json" }, "darwin", "/test-home").auth, path.resolve("/private-keys/auth.json"));
});

test("platform defaults are stable and honor the operating system's data location", () => {
	assert.equal(resolveLocalPaths({ APPDATA: "/roaming" }, "win32", "/test-home").data, path.resolve("/roaming/LearnHarness"));
	assert.equal(resolveLocalPaths({ XDG_DATA_HOME: "/xdg" }, "linux", "/test-home").data, path.resolve("/xdg/LearnHarness"));
	assert.equal(resolveLocalPaths({}, "linux", "/test-home").data, path.resolve("/test-home/.local/share/LearnHarness"));
});

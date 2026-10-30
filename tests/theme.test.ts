import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { ROSE_PINE_MOON as moon, DEFAULT_READING_FONT } from "../src/core/theme.ts";
import { derivedPalette, appearanceVars, resolveAppearance } from "../components/settings/appearance.tsx";
import { mermaidTheme } from "../components/mermaid-render.ts";

function luminance(hex: string) {
 const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
 return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

test("Moon's shared palette and CSS agree; secondary text and key controls retain contrast", () => {
 const css = fs.readFileSync("app/globals.css", "utf8");
 for (const [key, value] of Object.entries(moon)) {
  const token = key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
  assert.ok(css.includes(`--rp-${token}: ${value}`), key);
 }
 for (const bg of [moon.base, moon.surface, moon.overlay]) {
  assert.ok(contrast(moon.text, bg) >= 4.5);
  assert.ok(contrast("#a4a1bd", bg) >= 4.5, `secondary text on ${bg}`);
  assert.ok(contrast(moon.subtle, bg) >= 3, `input borders on ${bg}`);
 }
 assert.ok(contrast(moon.base, moon.rose) >= 4.5, "primary action label");
 assert.ok(contrast(moon.base, moon.love) >= 4.5, "destructive action label");
 assert.equal(derivedPalette(moon.base)["--card"], moon.surface);
 assert.equal(derivedPalette(moon.base)["--popover"], moon.overlay);
});

test("Hack is bundled with real regular, bold, italic and bold-italic faces and license", () => {
 assert.equal(DEFAULT_READING_FONT, "Hack Nerd Font");
 for (const face of ["Regular", "Bold", "Italic", "BoldItalic"]) {
  const font = fs.readFileSync(`public/fonts/hack/HackNerdFont-${face}.woff2`);
  assert.equal(font.subarray(0, 4).toString(), "wOF2");
 }
 assert.match(fs.readFileSync("public/fonts/hack/LICENSE.md", "utf8"), /Source Foundry Authors/);
 assert.equal(appearanceVars(resolveAppearance(undefined))["--font-title"], "var(--font-prose)");
 assert.equal(appearanceVars(resolveAppearance({ sessionNameSerif: true }))["--font-title"], '"lh-cmu", serif');
 assert.equal(mermaidTheme.themeVariables?.primaryTextColor, moon.text);
 assert.match(mermaidTheme.fontFamily!, /Hack Nerd Font/);
});

/**
 * The app's ONE mermaid renderer (the chrome-melt wave, 2026-09-19): both the
 * in-chat block (components/md-blocks.tsx) and the session-scoped focus
 * overlay (components/session-overlay.tsx) render charts through this module
 * — one dark-theme config, one plugin instance, unique render ids. This
 * REPLACES streamdown's internal mermaid path entirely: its fullscreen portal
 * was hard-wired `fixed inset-0` (covering the window-drag bar, X landing in
 * drag territory) with no styling hook, which is what drove the custom
 * component in the first place.
 */

import { createMermaidPlugin } from "@streamdown/mermaid";
import type { MermaidConfig } from "mermaid";
import { ROSE_PINE_MOON as moon } from "@/src/core";

/** The chart's base font size (px) — mermaid sizes ALL text relative to
 *  this, so it's the number the display-width cap (md-blocks) divides by:
 *  a chart shown at its natural width renders text at exactly this size.
 *  Pinned explicitly so a mermaid default change can't silently shift the
 *  cap (owner rule, chrome-melt tweaks wave, 2026-09-19: chart text must
 *  never render larger than the session's own text). */
export const MERMAID_FONT_SIZE = 16;

// The app is dark-only (html.dark in the root layout) — diagrams render in
// mermaid's dark theme. (Moved from ai-elements/message.tsx when the
// renderer became app-owned; the old `mermaid` prop wiring is retired.)
export const mermaidTheme: MermaidConfig = {
	fontFamily: '"Hack Nerd Font", ui-monospace, monospace',
	fontSize: MERMAID_FONT_SIZE,
	securityLevel: "strict",
	theme: "base",
	themeVariables: {
		darkMode: true, background: moon.base, primaryColor: moon.surface,
		primaryTextColor: moon.text, primaryBorderColor: moon.iris,
		secondaryColor: moon.overlay, tertiaryColor: moon.highlightLow,
		lineColor: moon.foam, textColor: moon.text, nodeTextColor: moon.text,
		mainBkg: moon.surface, clusterBkg: moon.base, clusterBorder: moon.highlightHigh,
		edgeLabelBackground: moon.base, titleColor: moon.rose,
	},
};

const plugin = createMermaidPlugin();

/** Render one chart source to an svg string. The id is unique per call —
 *  mermaid caches rendered ids, and a repeated id across charts/renders
 *  returns the stale svg (the bug streamdown's own id minting avoids). */
export async function renderMermaid(chart: string): Promise<string> {
	const id = `lh-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
	const { svg } = await plugin.getMermaid(mermaidTheme).render(id, chart);
	return svg;
}

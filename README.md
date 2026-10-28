<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="LearnHarness" width="640">
  </picture>
</p>

<p align="center"><strong>An agent harness for learning.</strong></p>

<p align="center">
  <a href="https://learnharness.ai">Download</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/development.md">Documentation</a> ·
  <a href="https://github.com/amosblomqvist/learnharness/issues">Issues</a> ·
  <a href="https://discord.gg/5tCHHQEB2e">Discord</a>
</p>

LearnHarness uses AI agents to plan and teach lessons from your current understanding to your goal. It builds a detailed picture of what you understand and how you reason. That picture is updated as you learn.

Instead of just giving you an explanation, it uses your answers and thinking to decide what you need next. Teaching builds understanding one reasoning step at a time. Practice makes it usable. A persistent knowledge graph carries it across sessions.

![LearnHarness teaching session](docs/assets/teaching-session.png)

## CodePawfect fork: evidence and delayed review

This fork adds a **Review** workspace with persistent learning goals, source-checked answer keys, independent application tasks, tutor observations linked to learner messages, and a due queue. Teaching preferences apply to the next tutor turn. Existing chats and the content graph remain compatible.

A graph node records what was covered. The separate learning history records what was attempted, with what help, how it was checked, and when. Demonstrated/retained labels require delayed, unaided answers to distinct checked questions; self-assessed projects and model judgments remain separately labeled. The interval schedule is a transparent heuristic, not a validated prediction of memory.

Open **Review** in the sidebar, create a measurable goal (or ask the tutor to propose one), check its answer keys against the cited references, and start a due review. Review works without a model connection; tutoring still uses your configured providers. No background notifications are scheduled.

See [the fork's learning design and operations](docs/evidence-based-learning.md) and [the evaluation protocol](docs/learning-evaluation.md). Export evidence from Review and run `npm run evaluate:learning -- /path/to/export.json` for descriptive delayed-transfer results. No learning-outcome benefit has yet been established by a controlled study.

### Easy local start

On macOS, double-click **Start.command** in the repository. It starts LearnHarness and opens your browser when the server is ready. Double-click **Daten.command** to open your saved-learning folder in Finder.

From a terminal, the equivalent commands are:

```sh
npm run local    # start with persistent storage
npm run data     # open the saved-learning folder
```

Run `npm ci` once if dependencies are missing. Stop the server with **Ctrl+C** in its terminal window; saved learning remains. Each launch prints the browser address and storage location. On macOS the stable default is `~/Library/Application Support/LearnHarness`, matching the earlier manual startup instructions. Chats, graph, settings, prompt overrides, `learning.json`, and provider keys entered in the app are kept there. Back up the entire folder securely. `npm run local -- --show-path` prints the location without starting anything.

Windows uses `%APPDATA%/LearnHarness`; Linux uses `$XDG_DATA_HOME/LearnHarness` or `~/.local/share/LearnHarness`. Explicit shell `LH_DATA_DIR` and `LH_AUTH_FILE` overrides remain supported. The launcher does not move or merge existing records from another location. Ordinary `npm run dev` retains its original checkout-local defaults. For a production server, build once with `npm run build`, then use `npm start` with explicit `LH_DATA_DIR` and `LH_AUTH_FILE` pointing to the same folder.

## How it works

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on. Your answers, confidence, and thinking show it where to start.
2. **Plan.** It works out a dependency map from that starting point to your goal. You can see the plan, and the lesson adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand. You predict, get an explanation, and check your understanding. Confusions are repaired before anything is built on them. The aim is for the goal to feel obviously true, not merely familiar.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first. Problems and hints adapt to your reasoning.

**Think out loud.** The thinking fields let you explain your reasoning, uncertainties, and reactions in your own words. This is how the agent gets a detailed picture rather than just a record of right and wrong answers. You can type or use dictation.

The agent can also research questions in the background, create visual explanations, and build interactive demonstrations.

## Knowledge that carries forward

What you are taught accumulates as propositions and reasoning chains: individual claims and the premises that lead to them. The graph shows this structure, with links back to the source sessions. You can also import notes.

Future teaching sessions can read the graph instead of starting from scratch. Practice sessions can draw their material from it. It stores the ideas and their connections, not ratings of your ability.

![LearnHarness knowledge graph](docs/assets/knowledge-graph.png)

## Download and get started

**[Download from learnharness.ai](https://learnharness.ai)** · [GitHub Releases](https://github.com/amosblomqvist/learnharness/releases)

- **macOS (Apple Silicon):** signed and notarized DMG. Drag the app to Applications.
- **Windows (x64):** run the installer. It is currently unsigned; Windows may show an “unknown publisher” or SmartScreen warning.
- **Linux (x64):** make the AppImage executable and open it, or install the Debian/Ubuntu `.deb`.

Add your provider API key and choose your models, then start a session with what you want to understand. LearnHarness supports 30+ provider options, including OpenAI, Anthropic, Google, DeepSeek, and OpenRouter. Optional dictation and web search use separate service keys.

All three platforms support in-app updates.

**Dictation:** Create a [Deepgram API key](https://console.deepgram.com/) with the **Member role or higher** ([required for token minting](https://developers.deepgram.com/reference/auth/tokens/grant)) and add it under **Settings → Providers → Dictation**. Choose the language below the key; **Multilingual** supports automatic recognition and mixed-language speech. A `403 Insufficient permissions` error during token minting can indicate an insufficient key role.

## Your keys, your data

- **Your keys and models.** No LearnHarness subscription or markup. You pay your providers for usage; a live cost meter shows model costs.
- **Local storage.** Your chats, graph, settings, and API keys live on your machine. Learning records are plain files you can inspect.
- **External services.** Models run through your configured providers. Model requests send the context needed for the task; web research and dictation also contact external services. Local storage does not mean offline processing.
- **Inspectable behavior.** System prompts are visible and editable. The app is open source under the AGPL-3.0 license.

## Development and support

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # deterministic, no LLM, no network
```

See the [development guide](docs/development.md), [architecture](docs/architecture.md), and [desktop release guide](docs/desktop-release.md).

Questions, bug reports, and feature requests: [GitHub Issues](https://github.com/amosblomqvist/learnharness/issues).

## License

[AGPL-3.0](LICENSE)

The app is free and open forever. If we ever charge for anything, it will be for convenience — managed keys, hosting — never for features you can run locally.

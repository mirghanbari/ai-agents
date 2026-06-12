# 🔬 Research Agent

An autonomous research analyst. Give it a question; it investigates with **live
web search**, reads sources in full, and returns a **cited markdown report** —
not an answer from stale training data.

Unlike the [travel-agent](../travel-agent), this needs **only an Anthropic API
key**: web search and page fetching run server-side on Anthropic's
infrastructure (the `web_search` / `web_fetch` tools), so there are no extra APIs
to sign up for and nothing to scrape.

## Two modes

| Mode | What it does | When |
| --- | --- | --- |
| **quick** (default) | One Opus agent runs a multi-round web search and writes a cited brief in a single pass. | Most questions — fast, cheap. |
| **deep** (`--deep`) | A planner decomposes the question into 3–5 subtopics, **parallel sub-agents** research each one with their own web access, then a lead analyst synthesizes a long, sectioned report. | Hard, broad, or high-stakes questions worth the extra time/tokens. |

Both run on `claude-opus-4-8` with adaptive thinking; deep mode bumps the effort
level up one notch automatically.

## Setup

```bash
cd research-agent
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY (model defaults to claude-opus-4-8)
```

## Usage

```bash
# quick
npm run research -- "What are the 2026 EU AI Act compliance deadlines?"

# deep, save to a file
npm run research -- "State of solid-state EV batteries in 2026" --deep --out report.md

# force an effort level
npm run research -- "Compare Postgres vs SQLite for edge apps" --effort xhigh
```

> The `--` after `research` is required so npm forwards the flags to the script
> rather than consuming them itself.

**Flags:** `--deep`, `--effort <low|medium|high|xhigh|max>`, `--out <file>`,
`--quiet`, `--help`.

The report streams to **stdout**; progress and a token/cost footer go to
**stderr** — so `npm run research -- "..." --quiet > out.md` captures just the
clean report.

## How it's built

```
src/
├── cli.ts              # arg parsing, streaming output, cost footer
├── lib/
│   ├── env.ts          # loads .env, effort parsing/bumping
│   └── anthropic.ts    # runTurn(): Opus + adaptive thinking + effort, handles
│                       #   the pause_turn continuation server-side web tools trigger
└── agent/
    ├── tools.ts        # web_search_20260209 + web_fetch_20260209 (server-side)
    ├── prompts.ts      # analyst / researcher / synthesizer / planner system prompts
    └── research.ts     # quick (single pass) + deep (plan → parallel sub-agents → synthesis)
```

The core knob is **effort** (`low`→`max`), which controls how hard Opus thinks
and how many tool rounds it runs. Deep mode's power comes from fanning out
independent subtopics to parallel sub-agents, each with its own context window
and web access, then synthesizing — the same pattern behind "deep research"
products.

## Notes & extension ideas

- No `any` — the agent loop is fully typed against the Anthropic SDK.
- Citations come from the model's web-search results; prompts require inline
  source URLs and a consolidated Sources list.
- Easy next steps: add `web_fetch` allow-lists to restrict domains, add a
  `--json` output mode, persist reports, or expose `research()` behind an HTTP
  endpoint to give it a UI like the travel agent.

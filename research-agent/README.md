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

## Usage — CLI

```bash
# quick
npm run research -- "What are the 2026 EU AI Act compliance deadlines?"

# deep, thorough budget, save to a file
npm run research -- "State of solid-state EV batteries in 2026" --deep --budget thorough --out report.md

# cheap pass restricted to specific domains
npm run research -- "Latest React 19 features" --budget lite --domains react.dev,github.com
```

> The `--` after `research` is required so npm forwards the flags to the script
> rather than consuming them itself.

**Flags:** `--deep`, `--budget <lite|standard|thorough>`,
`--effort <low|medium|high|xhigh|max>`, `--domains <a,b>`, `--out <file>`,
`--quiet`, `--help`.

## Usage — web UI

```bash
npm run serve     # → http://localhost:3002
```

A single-page UI: type a question, pick mode/budget/effort, and the cited report
streams in live (rendered markdown) with a progress log and a token/cost footer.
The same `research()` core powers both the CLI and the server (SSE).

## Cost guardrails ("handcuffs")

Web research is cheap to start and expensive to run away with — `web_fetch`
pulls whole pages into context. Every run is bounded by a **budget**:

| Knob | What it caps | lite · standard · thorough |
| --- | --- | --- |
| `fetchContentTokens` | tokens of page text each fetch injects (the main blow-up vector) | 2.5k · 4k · 6k |
| `fetchUses` / `searchUses` | number of fetches / searches per request (server-enforced) | 3/3 · 4/5 · 6/8 |
| `maxTokens` | output tokens per turn | 4k · 8k · 16k |
| `maxContinuations` | `pause_turn` resumes | 1 · 2 · 3 |
| `tokenCeiling` | **hard client-side stop** on cumulative tokens | 60k · 120k · 300k |
| `maxSubtopics` | deep-mode parallel sub-agents | 3 · 4 · 5 |

Effect, measured on the same query: capping page content took a quick run from
**~154k input tokens / $0.86** down to **~35k / $0.23** on the `lite` budget. In
deep mode, sub-agents get an automatically *lighter* budget so N parallel agents
stay bounded, and the report is flagged `truncated` if it hits the ceiling.
Defaults to `standard`; override per run with `--budget` (CLI) or the dropdown (UI).

The report streams to **stdout**; progress and a token/cost footer go to
**stderr** — so `npm run research -- "..." --quiet > out.md` captures just the
clean report.

## How it's built

```
src/
├── cli.ts              # CLI: arg parsing, streaming output, cost footer
├── server.ts           # web UI: Express + SSE, same research() core
├── lib/
│   ├── env.ts          # loads .env, effort parsing/bumping
│   ├── budget.ts       # the cost handcuffs (lite/standard/thorough presets)
│   └── anthropic.ts    # runTurn(): Opus + adaptive thinking + effort + token
│                       #   ceiling; handles the pause_turn web-tool continuation
└── agent/
    ├── tools.ts        # web_search/web_fetch with max_uses + max_content_tokens
    ├── prompts.ts      # analyst / researcher / synthesizer / planner system prompts
    └── research.ts     # quick (single pass) + deep (plan → parallel sub-agents → synthesis)
public/                 # index.html + app.js (streamed markdown report)
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

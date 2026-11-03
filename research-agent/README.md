# 🔬 Research Agent

An autonomous research analyst. Give it a question; it investigates with **live
web search**, reads sources in full, and returns a **cited markdown report** —
not an answer from stale training data.

There are no extra APIs to sign up for and nothing to scrape: web search and page
fetching come built in with Claude.

## Two modes

| Mode | What it does | When |
| --- | --- | --- |
| **quick** (default) | One Opus agent runs a multi-round web search and writes a cited brief in a single pass. | Most questions — fast, cheap. |
| **deep** (`--deep`) | A planner decomposes the question into 3–5 subtopics, **parallel sub-agents** research each one with their own web access, then a lead analyst synthesizes a long, sectioned report. | Hard, broad, or high-stakes questions worth the extra time/tokens. |

Both run on `claude-opus-5-5` with adaptive thinking; deep mode bumps the effort
level up one notch automatically.

## Billing: subscription (default) or API credits

| Billing | How it runs | Auth |
| --- | --- | --- |
| **subscription** (default) | Through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), using Claude Code's built-in `WebSearch` / `WebFetch` tools. Runs count against your Claude Pro/Max plan's usage limits. | Your existing `claude login`. For headless use, `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` in `.env`. |
| **credits** (`--credits`) | Directly on the Messages API with the server-side `web_search` / `web_fetch` tools. Pay-as-you-go. | `ANTHROPIC_API_KEY` in `.env`. |

The subscription path deliberately removes `ANTHROPIC_API_KEY` from the Agent SDK
subprocess's environment. If the key were present, Claude Code would prefer it
and quietly bill credits. Set `RESEARCH_BILLING=credits` in `.env` to flip the
default.

Deep mode starts one Agent SDK session per subtopic in parallel, so a deep run
uses plan usage several times faster than a quick one.

## Setup

```bash
cd research-agent
npm install
cp .env.example .env     # optional for subscription billing; add ANTHROPIC_API_KEY for --credits
claude login             # if you haven't already (subscription billing)
```

## Usage — CLI

```bash
# quick (billed to your subscription)
npm run research -- "What are the 2026 EU AI Act compliance deadlines?"

# deep, thorough budget, save to a file
npm run research -- "State of solid-state EV batteries in 2026" --deep --budget thorough --out report.md

# cheap pass restricted to specific domains, billed to API credits
npm run research -- "Latest React 19 features" --budget lite --domains react.dev,github.com --credits
```

> The `--` after `research` is required so npm forwards the flags to the script
> rather than consuming them itself.

**Flags:** `--deep`, `--subscription` / `--credits`,
`--budget <lite|standard|thorough>`, `--effort <low|medium|high|xhigh|max>`,
`--domains <a,b>`, `--out <file>`, `--quiet`, `--help`.

## Usage — web UI

```bash
npm run serve     # → http://localhost:3002
```

A single-page UI: type a question, pick billing/mode/budget/effort, and the cited
report streams in live (rendered markdown). A status line shows the **current
phase** (*searching the web → reading a source → thinking → writing*) with a
ticking elapsed-seconds counter, so long phases never look frozen, plus a
token/cost footer at the end. Billing preselects the server default and greys
out credits when no API key is set. Closing the tab stops the run. The same
`research()` core powers both the CLI and the server (SSE).

## Cost guardrails ("handcuffs")

Web research is cheap to start and expensive to run away with — fetches pull
pages into context. Every run is bounded by a **budget**:

| Knob | What it caps | lite · standard · thorough |
| --- | --- | --- |
| `searchUses` / `fetchUses` | searches / fetches per turn; kept low so the model never trips `pause_turn` | 2/1 · 3/2 · 5/4 |
| `fetchContentTokens` | tokens of page text each fetch injects (the main blow-up vector) | 2.5k · 3.5k · 5k |
| `maxTokens` | output tokens per turn (thinking included) | 4k · 6k · 12k |
| `maxContinuations` | `pause_turn` resumes (each re-sends context — expensive) | 0 · 1 · 2 |
| `tokenCeiling` | **hard client-side stop** on cumulative tokens | 45k · 80k · 200k |
| `maxSubtopics` | deep-mode parallel sub-agents | 3 · 4 · 5 |

All of these apply on **credits**, where the API enforces them. On
**subscription**, `searchUses` / `fetchUses`, the domain allow-list, and
`maxSubtopics` are enforced too (by a `PreToolUse` hook that denies calls over
budget), and the loop is capped at `searchUses + fetchUses + 3` turns. The
token knobs have no Agent SDK equivalent. Claude Code's `WebFetch` returns a
model-written digest of the page, not raw page text, so that blow-up vector is
smaller there anyway.

The system prompt also tells the model to **right-size** research — a simple
factual lookup gets one or two searches and stops, instead of exhaustively
cross-checking. On Opus 4.8, these knobs took a quick factual query (*"nutritional
value of a glass of milk"*) from **~150k input tokens / ~3 min / $0.86** down to
**~41k / 45s / $0.26** on the `standard` budget, with no loss of answer quality.
In deep mode, sub-agents get an automatically *lighter* budget so N parallel
agents stay bounded, and the report is flagged `truncated` if it hits a limit.
Defaults to `standard` + `medium` effort; override per run with `--budget` /
`--effort` (CLI) or the dropdowns (UI).

**Refusals.** Opus 5.5 runs safety classifiers (cyber, bio), which can
occasionally flag a benign research question. On credits, the request opts into
the API's server-side fallback and re-runs on `ANTHROPIC_FALLBACK_MODEL`
(default `claude-opus-4-8`; set `none` to disable). On subscription, Claude Code
applies its own refusal fallback. If every model declines, the report ends with a
visible note instead of stopping silently.

The report streams to **stdout**; progress and a token/cost footer go to
**stderr** — so `npm run research -- "..." --quiet > out.md` captures just the
clean report.

## How it's built

```
src/
├── cli.ts              # CLI: arg parsing, streaming output, cost footer
├── server.ts           # web UI: Express + SSE, same research() core
├── lib/
│   ├── env.ts          # loads .env, effort parsing/bumping, billing default
│   ├── budget.ts       # the cost handcuffs (lite/standard/thorough presets)
│   ├── anthropic.ts    # runTurnCredits(): Messages API, adaptive thinking, effort,
│   │                   #   token ceiling, refusal fallback, pause_turn continuation
│   └── subscription.ts # runTurnSubscription(): same turn via the Agent SDK,
│                       #   web tools gated by a budget-enforcing PreToolUse hook
└── agent/
    ├── tools.ts        # web_search/web_fetch with max_uses + max_content_tokens
    ├── prompts.ts      # analyst / researcher / synthesizer / planner system prompts
    └── research.ts     # quick (single pass) + deep (plan → parallel sub-agents → synthesis);
                        #   picks the runner by billing
public/                 # index.html + app.js (streamed markdown report)
```

The core knob is **effort** (`low`→`max`), which controls how hard Opus thinks
and how many tool rounds it runs. Opus 5.5 defaults to `medium` if effort is
omitted, so the agent always sets it explicitly. Deep mode's power comes from
fanning out independent subtopics to parallel sub-agents, each with its own
context window and web access, then synthesizing — the same pattern behind
"deep research" products.

## Notes & extension ideas

- No `any`: both runners are fully typed against the Anthropic and Agent SDKs.
- Citations come from the model's web-search results; prompts require inline
  source URLs and a consolidated Sources list.
- Easy next steps: add a `--json` output mode, or persist reports.

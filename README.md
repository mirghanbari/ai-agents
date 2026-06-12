# ai-agents

A collection of self-contained AI agents. Each agent lives in its own
subdirectory with its own dependencies, environment, and README.

## Agents

| Agent | Path | What it does |
| --- | --- | --- |
| 🧭 **Wayfarer** | [`travel-agent/`](travel-agent) | Full-stack agentic travel agent — Claude orchestrates flights, hotels, vacation rentals, cars, and activities in parallel via tool use, and streams a synthesized recommendation to a React UI. |
| 🔬 **Research Agent** | [`research-agent/`](research-agent) | Autonomous research analyst — Claude investigates a question with live web search and returns a cited report (CLI). Has a `--deep` mode that fans out to parallel sub-agents. Needs only an Anthropic key. |

## Getting started

Each agent is independent — `cd` into its folder and follow its README:

```bash
cd travel-agent
npm run install:all
# … see travel-agent/README.md for the rest
```

## Adding a new agent

Create a new top-level folder (e.g. `research-agent/`) with its own
`package.json` and README. The root `.gitignore` already covers
`node_modules/`, `dist/`, and `.env` at any depth, so each agent keeps its
secrets out of version control automatically.

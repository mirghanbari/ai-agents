# 🧭 Wayfarer — AI Travel Agent

An agentic, full-stack AI travel agent. A Claude backend (the **Wayfarer**
persona) parses your request, fans out searches across flights, hotels, vacation
rentals, rental cars, activities, and event tickets **in parallel**, then
synthesizes the results into a curated recommendation — streamed token-by-token
to a React UI.

```
You ───▶ Express /api/chat (SSE) ───▶ Claude (tool use)
                                         │  parallel tool calls
                 ┌──────────────────┬────┼─────────────────┬──────────────────┐
             Duffel API    Booking/Viator (RapidAPI)  SeatGeek API     Playwright + stealth
            (flights)      (hotels, activities)       (event tickets)  (Airbnb / VRBO / Kayak / StubHub)
                 └──────────────────┴────┼─────────────────┴──────────────────┘
                                  Claude synthesizes ─▶ streamed back to the UI
```

## Stack

- **Frontend** — React 18 + TypeScript + Vite, Tailwind CSS v3, TanStack Query
  (server state), Zustand (UI + itinerary state), React Hook Form + Zod.
- **Backend** — Node + Express + TypeScript, Anthropic SDK with tool use, SSE streaming.
- **Search** — axios for API integrations (Duffel flights, RapidAPI Booking/Viator,
  SeatGeek/StubHub tickets); Playwright + `playwright-extra` + stealth for
  Airbnb / VRBO / Kayak / StubHub scraping.

## Project layout

```
ai-agents/
├── shared/travel.ts          # canonical domain types (client + server re-export this)
├── server/
│   ├── scripts/             # manual smoke tests (smoke-events.ts, smoke-stubhub.ts)
│   └── src/
│       ├── index.ts          # Express app + CORS + /api/health
│       ├── agent/
│       │   ├── tools.ts      # Claude tool defs + Zod validation + executeToolCall dispatch
│       │   ├── synthesizer.ts# the Wayfarer system prompt
│       │   └── index.ts      # orchestrator (direct-search fan-out, re-exports)
│       ├── routes/
│       │   ├── chat.ts       # POST /api/chat — SSE, Claude→tools→Claude loop (max 3 iters)
│       │   └── search.ts     # POST /api/search — direct, non-AI fan-out
│       ├── api/              # flights.ts, hotels.ts, activities.ts, events.ts (HTTP APIs)
│       ├── scrapers/         # browser.ts, airbnb.ts, vrbo.ts, cars.ts, stubhub.ts (Playwright)
│       └── lib/              # env.ts, coerce.ts (typed unknown narrowing), results.ts
└── client/
    └── src/
        ├── App.tsx           # layout: chat (left) + collapsible itinerary (right)
        ├── hooks/            # useChat (SSE reader), useItinerary (localStorage store)
        ├── store/uiStore.ts  # tabs / panel UI state
        ├── components/       # ChatInterface, MessageBubble, ResultsTabs, ItineraryPanel, cards/
        └── lib/format.ts     # money/time formatting, itinerary export
```

## Setup

```bash
npm run install:all        # installs root, client, and server deps
npm run playwright:install # downloads the Chromium build for scraping
cp .env.example .env        # then fill in your keys (see below)
npm run dev                 # client → http://localhost:5173, server → http://localhost:3001
```

The Vite dev server proxies `/api/*` to the Express server, so you only open
**http://localhost:5173**.

### API keys

Everything degrades gracefully — a missing key disables **only** that one source
and the agent narrates the gap. You can run with just `ANTHROPIC_API_KEY` and the
scrapers (no keys needed); add the rest as you go.

| Source | Variable | Where to get it |
| --- | --- | --- |
| **Claude (required)** | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| Claude via subscription (alt) | `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` — or just `claude login` and leave it blank |
| Flights | `DUFFEL_ACCESS_TOKEN` | https://app.duffel.com (free test tokens; searching is free) |
| Hotels + Activities | `RAPIDAPI_KEY` | https://rapidapi.com (subscribe to Booking.com + a Tours/Travel-Advisor API) |
| Activities (alt) | `VIATOR_API_KEY` | https://api.viator.com/partner |
| Event tickets | `SEATGEEK_CLIENT_ID` | https://seatgeek.com/account/develop (free) |
| Event tickets (alt) | `STUBHUB_CLIENT_ID` / `STUBHUB_CLIENT_SECRET` | https://developer.stubhub.com (partner program) |
| Airbnb / VRBO / Cars / StubHub | _none_ | Playwright scrapers — just run `playwright:install` |

`GET /api/health` reports which sources are configured.

### Two ways to pay for Claude

The agent can run on either billing model, and the UI can switch between them:

- **API credits** (`ANTHROPIC_API_KEY`) → `POST /api/chat`. Pay-as-you-go from
  the Anthropic Console; the classic path.
- **Claude Pro/Max subscription** (no per-request charge) → `POST /api/chat/subscription`.
  Runs the same Wayfarer agent and the same seven searches through the
  [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which
  authenticates against your Claude subscription instead of billing credits.
  If you're already logged in with `claude login`, it works with no extra
  config; for a headless server, set `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`).
  The subscription route deliberately strips `ANTHROPIC_API_KEY` from the SDK
  subprocess so it can't silently fall back to credit billing.

Both routes stream the identical SSE event protocol, so the React client uses
whichever you point it at.

## Model note

The agent uses **`claude-sonnet-4-6`** (set via `ANTHROPIC_MODEL`). The original
brief pinned `claude-sonnet-4-20250514`, which is the older Sonnet 4 snapshot and
is **deprecated (retires 2026-06-15)** — `claude-sonnet-4-6` is the current
same-tier replacement (1M context, adaptive thinking). Swap to `claude-opus-4-8`
in `.env` for stronger synthesis at higher cost.

## Dev runner note

The brief specified `ts-node --esm` for the server. This project uses **`tsx`**
instead (`npm run dev` → `tsx watch`). `ts-node --esm` requires `.js` extensions
on every relative import under NodeNext and is brittle across a multi-file ESM
project; `tsx` runs the TypeScript ESM source directly with none of that
friction. `npm run build` in `server/` is a `tsc --noEmit` typecheck (the server
runs from source via `tsx`, so there is no separate compile step).

## Debugging scrapers

Scrapers are the brittle part of any travel tool — sites change layouts and fight
bots. Robustness is layered:

1. **Retries with fresh sessions** — every scrape runs up to `SCRAPER_ATTEMPTS`
   (default 2) times; each attempt gets a brand-new browser context with a
   different fingerprint (UA/viewport/timezone), since challenges are usually
   per-session.
2. **Block detection** — after a failed harvest the rendered page is checked for
   CAPTCHA / press-and-hold / access-denied interstitials, so the agent reports
   *"blocked by a CAPTCHA challenge"* instead of a misleading "0 results".
3. **Layered extraction** — each scraper tries the site's own JSON API responses
   (XHR intercept, exact shape first, then structural matching), then falls back
   to DOM scraping. A site redesign degrades gracefully to an error rather than
   crashing the whole search.
4. **Geocode verification (Airbnb)** — Airbnb's geocoder silently resolves
   ambiguous towns to bigger namesakes ("Long Beach, WA" → Long Beach, CA). The
   query is independently geocoded via OSM Nominatim and listings whose
   coordinates land in the wrong region are dropped; if *everything* landed
   wrong, the error tells the agent to retry with a disambiguated query.
5. **Proxy support** — set `PROXY_SERVER` (+ optional `PROXY_USERNAME` /
   `PROXY_PASSWORD`). Blocks are mostly IP-reputation based, so a residential
   or ISP proxy is the biggest reliability upgrade on a flagged/datacenter IP.

If a scraper still returns 0 results, set `HEADLESS=false` in `.env` and re-run —
you'll see the real browser and can spot a CAPTCHA, login wall, or layout change.

### Known bot-detection issues per site

- **Airbnb** — intercepts `StaysSearch` GraphQL responses; aggressive on
  datacenter IPs. Residential IP + `HEADLESS=false` is most reliable.
- **VRBO** — intercepts `propertyAvailabilitySearchResults`; occasionally serves
  an interstitial. The DOM fallback targets `[data-stid="property-listing"]`.
- **Kayak (cars)** — the most aggressive. Uses 3–5s delays and simulated mouse
  movement; still expect frequent blocks. Treat car results as best-effort and
  fall back to booking directly.
- **StubHub (tickets)** — only used as a fallback when no StubHub partner keys are
  set. The results list is virtualized behind bot defense, so the scraper
  step-scrolls and harvests cards before they unmount; most reliable on a
  residential IP with `HEADLESS=false`. SeatGeek (API) is unaffected.

## Quality standards

- No `any` — third-party JSON is narrowed from `unknown` via `lib/coerce.ts`.
- Every source runs under `Promise.allSettled` and every tool call is wrapped in
  try/catch returning a structured error — one failing source never blocks the rest.
- Scrapers run in **isolated browser contexts** (separate cookies/session); a
  Playwright crash in one scraper can't affect the hotels API call.
- Tool inputs are validated with **Zod** before execution.
- React components stay small and focused (sub-components extracted aggressively).
- **Unit tests (Vitest)** cover the pure, deterministic core — the `unknown`→typed
  coercers (`lib/coerce.ts`), the SeatGeek/StubHub response mappers + ticket
  filters (`api/events.ts`), and the StubHub card/date parsing (`scrapers/stubhub.ts`).
  Run `npm test` in `server/` (or `npm test` at the root). Network/scraper layers
  stay covered by the manual smoke scripts in `server/scripts/`.

## How it works (request lifecycle)

1. The UI POSTs the conversation + new message to `/api/chat` and reads the SSE stream.
2. Claude receives the [Wayfarer system prompt](server/src/agent/synthesizer.ts)
   and the seven tool definitions, and decides which searches are relevant.
3. On `tool_use`, the server executes **all** tool calls in parallel
   (`Promise.allSettled`), streaming `searching` and `partial_results` events.
4. Tool results go back to Claude, which synthesizes a final recommendation —
   streamed to the UI as `token` events.
5. The full `SearchResults` is attached to the assistant message; the UI renders
   it in the tabs, and you save items (♡) into a localStorage-backed itinerary.

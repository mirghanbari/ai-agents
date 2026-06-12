import type Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic's server-side web tools — search runs and pages are fetched on
 * Anthropic's infrastructure, with dynamic result filtering (the _20260209
 * versions). No API keys or scraping on our side; citations come back automatically.
 *
 * `maxUses` caps tool calls per request to bound cost/latency.
 */
export function webTools(maxUses: number): Anthropic.ToolUnion[] {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxUses },
  ];
}

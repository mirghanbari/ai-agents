import type Anthropic from '@anthropic-ai/sdk';
import type { Budget } from '../lib/budget';

export interface DomainLimits {
  /** If set, only these domains may appear in results / be fetched. */
  allow?: string[];
  /** If set (and no allow-list), these domains are excluded. */
  block?: string[];
}

/**
 * Anthropic's server-side web tools, handcuffed by the budget:
 * - `max_uses` caps how many times each tool runs per request,
 * - `max_content_tokens` caps how much of each fetched page enters context (the
 *   main token blow-up vector),
 * - optional domain allow/block list restricts where it can go.
 * No API keys or scraping on our side; citations come back automatically.
 */
export function webTools(budget: Budget, domains?: DomainLimits): Anthropic.ToolUnion[] {
  // allowed_domains and blocked_domains are mutually exclusive — allow wins.
  const search: Anthropic.WebSearchTool20260209 = {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: budget.searchUses,
    ...(domains?.allow?.length
      ? { allowed_domains: domains.allow }
      : domains?.block?.length
        ? { blocked_domains: domains.block }
        : {}),
  };
  const fetch: Anthropic.WebFetchTool20260209 = {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
    max_uses: budget.fetchUses,
    max_content_tokens: budget.fetchContentTokens,
    ...(domains?.allow?.length
      ? { allowed_domains: domains.allow }
      : domains?.block?.length
        ? { blocked_domains: domains.block }
        : {}),
  };
  return [search, fetch];
}

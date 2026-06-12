// Cost "handcuffs". Every knob here bounds how many tokens a run can burn.
// The two that matter most: `fetchContentTokens` caps how much of each fetched
// page enters context (the main blow-up vector), and `tokenCeiling` is a hard
// client-side stop on cumulative tokens so a run can never spiral.

export interface Budget {
  /** Max web_search calls per request (server-enforced via max_uses). */
  searchUses: number;
  /** Max web_fetch calls per request (server-enforced via max_uses). */
  fetchUses: number;
  /** Max tokens of page text each web_fetch may inject (server-enforced). */
  fetchContentTokens: number;
  /** Output token cap per turn. */
  maxTokens: number;
  /** Max pause_turn resumes (server tool-loop continuations). */
  maxContinuations: number;
  /** Hard client-side stop: abort the turn chain once cumulative in+out tokens exceed this. */
  tokenCeiling: number;
  /** Deep mode: max subtopics (parallel sub-agents). */
  maxSubtopics: number;
}

export type BudgetName = 'lite' | 'standard' | 'thorough';

export const BUDGETS: Record<BudgetName, Budget> = {
  lite: {
    searchUses: 3,
    fetchUses: 3,
    fetchContentTokens: 2500,
    maxTokens: 4000,
    maxContinuations: 1,
    tokenCeiling: 60_000,
    maxSubtopics: 3,
  },
  standard: {
    searchUses: 5,
    fetchUses: 4,
    fetchContentTokens: 4000,
    maxTokens: 8000,
    maxContinuations: 2,
    tokenCeiling: 120_000,
    maxSubtopics: 4,
  },
  thorough: {
    searchUses: 8,
    fetchUses: 6,
    fetchContentTokens: 6000,
    maxTokens: 16_000,
    maxContinuations: 3,
    tokenCeiling: 300_000,
    maxSubtopics: 5,
  },
};

export const DEFAULT_BUDGET: BudgetName = 'standard';

export function resolveBudget(name: string | undefined): Budget {
  return BUDGETS[(name as BudgetName) in BUDGETS ? (name as BudgetName) : DEFAULT_BUDGET];
}

/** A reduced budget for deep-mode sub-agents so N of them stay bounded. */
export function lighter(b: Budget): Budget {
  return {
    ...b,
    searchUses: Math.max(2, Math.ceil(b.searchUses * 0.6)),
    fetchUses: Math.max(2, Math.ceil(b.fetchUses * 0.6)),
    maxTokens: Math.min(b.maxTokens, 6000),
    maxContinuations: 1,
    tokenCeiling: Math.min(b.tokenCeiling, 80_000),
  };
}

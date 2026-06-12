import { writeFile } from 'node:fs/promises';
import { bumpEffort, env, type Effort } from './lib/env';
import { BUDGETS, DEFAULT_BUDGET, resolveBudget, type BudgetName } from './lib/budget';
import { research } from './agent/research';

interface Args {
  question: string;
  deep: boolean;
  effort?: Effort;
  budget: BudgetName;
  domains?: string[];
  out?: string;
  quiet: boolean;
  help: boolean;
}

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const BUDGET_NAMES = Object.keys(BUDGETS) as BudgetName[];

function parseArgs(argv: string[]): Args {
  const args: Args = { question: '', deep: false, budget: DEFAULT_BUDGET, quiet: false, help: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--deep') args.deep = true;
    else if (a === '--quiet' || a === '-q') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--effort') args.effort = EFFORTS.find((e) => e === argv[++i]);
    else if (a.startsWith('--effort=')) args.effort = EFFORTS.find((e) => e === a.split('=')[1]);
    else if (a === '--budget') args.budget = pickBudget(argv[++i]);
    else if (a.startsWith('--budget=')) args.budget = pickBudget(a.split('=')[1]);
    else if (a === '--domains') args.domains = splitDomains(argv[++i]);
    else if (a.startsWith('--domains=')) args.domains = splitDomains(a.split('=')[1]);
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.split('=')[1];
    else if (!a.startsWith('-')) words.push(a);
  }
  args.question = words.join(' ').trim();
  return args;
}

function pickBudget(value: string | undefined): BudgetName {
  return BUDGET_NAMES.find((b) => b === value) ?? DEFAULT_BUDGET;
}

function splitDomains(value: string | undefined): string[] | undefined {
  const list = (value ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

const HELP = `research-agent — autonomous research analyst (Claude + live web search)

Usage:
  npm run research -- "<question>" [--deep] [--budget <name>] [--effort <level>] [--out file.md]

Options:
  --deep              Plan subtopics and research them with parallel sub-agents,
                      then synthesize. Slower & costlier; far more thorough.
  --budget <name>     lite | standard | thorough  (default: ${DEFAULT_BUDGET})
                      Caps searches, page-content tokens, and a hard token ceiling.
  --effort <level>    low | medium | high | xhigh | max  (default: ${env.effort})
  --domains <a,b>     Restrict web search/fetch to these domains (allow-list).
  --out, -o <file>    Also write the report to a file.
  --quiet, -q         Suppress progress lines on stderr.
  --help, -h          Show this help.

Examples:
  npm run research -- "What are the 2026 EU AI Act compliance deadlines?"
  npm run research -- "State of solid-state EV batteries" --deep --budget thorough --out report.md
  npm run research -- "Latest React 19 features" --domains react.dev,github.com`;

function err(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.question) {
    process.stdout.write(`${HELP}\n`);
    process.exit(args.question ? 0 : 1);
  }
  if (!env.anthropicApiKey) {
    err('✖ ANTHROPIC_API_KEY is not set. Add it to research-agent/.env');
    process.exit(1);
  }

  const effort: Effort = args.effort ?? (args.deep ? bumpEffort(env.effort) : env.effort);
  const budget = resolveBudget(args.budget);
  const mode = args.deep ? 'deep' : 'quick';
  const started = Date.now();

  if (!args.quiet) {
    err(`🔎 ${mode} research · ${env.anthropicModel} · effort:${effort} · budget:${args.budget}`);
    err(`   "${args.question}"\n`);
  }

  try {
    const result = await research(args.question, {
      mode,
      effort,
      budget,
      domains: args.domains ? { allow: args.domains } : undefined,
      onText: (delta) => process.stdout.write(delta),
      onProgress: args.quiet ? undefined : (line) => err(line),
    });

    process.stdout.write('\n');

    if (args.out) {
      await writeFile(args.out, result.report, 'utf8');
      if (!args.quiet) err(`\n💾 wrote ${args.out}`);
    }

    if (!args.quiet) {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const cost = (result.inputTokens * 5 + result.outputTokens * 25) / 1_000_000;
      if (result.truncated) err('\n⚠  hit the token ceiling — report may be partial (raise --budget to go further)');
      err(
        `\n⏱  ${secs}s · ${result.inputTokens.toLocaleString()} in / ` +
          `${result.outputTokens.toLocaleString()} out tokens · ~$${cost.toFixed(3)}`,
      );
    }
  } catch (e: unknown) {
    err(`\n✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

void main();

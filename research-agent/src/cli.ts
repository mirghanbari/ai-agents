import { writeFile } from 'node:fs/promises';
import { bumpEffort, env, type Effort } from './lib/env';
import { research } from './agent/research';

interface Args {
  question: string;
  deep: boolean;
  effort?: Effort;
  out?: string;
  quiet: boolean;
  help: boolean;
}

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function parseArgs(argv: string[]): Args {
  const args: Args = { question: '', deep: false, quiet: false, help: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--deep') args.deep = true;
    else if (a === '--quiet' || a === '-q') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--effort') args.effort = EFFORTS.find((e) => e === argv[++i]);
    else if (a.startsWith('--effort=')) args.effort = EFFORTS.find((e) => e === a.split('=')[1]);
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.split('=')[1];
    else if (!a.startsWith('-')) words.push(a);
  }
  args.question = words.join(' ').trim();
  return args;
}

const HELP = `research-agent — autonomous research analyst (Claude + live web search)

Usage:
  npm run research -- "<question>" [--deep] [--effort <level>] [--out file.md]

Options:
  --deep              Plan subtopics and research them with parallel sub-agents,
                      then synthesize. Slower & costlier; far more thorough.
  --effort <level>    low | medium | high | xhigh | max  (default: ${env.effort}${''})
  --out, -o <file>    Also write the report to a file.
  --quiet, -q         Suppress progress lines on stderr.
  --help, -h          Show this help.

Examples:
  npm run research -- "What are the 2026 EU AI Act compliance deadlines?"
  npm run research -- "State of solid-state EV batteries" --deep --out report.md`;

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
  const mode = args.deep ? 'deep' : 'quick';
  const started = Date.now();

  if (!args.quiet) {
    err(`🔎 ${mode} research · ${env.anthropicModel} · effort:${effort}`);
    err(`   "${args.question}"\n`);
  }

  try {
    const result = await research(args.question, {
      mode,
      effort,
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

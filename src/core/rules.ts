import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { getWorkspaceRoot } from './tools.js';

/**
 * Project rules: standing instructions the agent should follow in this
 * repository, kept in the repository rather than repeated in every prompt.
 *
 * Discovery walks up from the workspace root so a rule file at the top of a
 * monorepo applies to a package inside it, with the nearest file last — closest
 * to the work wins.
 */
export interface RuleFile {
  path: string;
  content: string;
}

/** Recognised at any level, in this order of preference within a directory. */
const RULE_FILENAMES = ['AGENTS.md', 'CUDE.md', '.cuderules'];
const RULE_DIRECTORY = join('.cude', 'rules');

/** Guards against a rule file large enough to crowd out the actual task. */
export const MAX_RULE_CHARS = 32_000;

function readRuleDirectory(dir: string): RuleFile[] {
  const rulesDir = join(dir, RULE_DIRECTORY);
  if (!existsSync(rulesDir)) return [];
  try {
    return readdirSync(rulesDir)
      .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
      .sort()
      .map(f => join(rulesDir, f))
      .filter(p => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .map(p => ({ path: p, content: readFileSync(p, 'utf-8') }));
  } catch {
    return [];
  }
}

export function findRuleFiles(startDir?: string): RuleFile[] {
  const start = resolve(startDir ?? getWorkspaceRoot());

  // Collect directories from the filesystem root down to `start`, so the
  // nearest rules are appended last.
  const chain: string[] = [];
  let current = start;
  for (;;) {
    chain.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const found: RuleFile[] = [];
  for (const dir of chain) {
    for (const name of RULE_FILENAMES) {
      const path = join(dir, name);
      try {
        if (existsSync(path) && statSync(path).isFile()) {
          found.push({ path, content: readFileSync(path, 'utf-8') });
        }
      } catch {
        // An unreadable rule file must never block a run.
      }
    }
    found.push(...readRuleDirectory(dir));
  }

  return found;
}

/**
 * The rules block appended to the system prompt, or '' when there are none.
 * Each file is labelled with its path so the model can say which rule it is
 * following.
 */
export function buildRulesPrompt(files?: RuleFile[]): string {
  const rules = files ?? findRuleFiles();
  if (rules.length === 0) return '';

  const root = getWorkspaceRoot();
  const sections: string[] = [];
  let budget = MAX_RULE_CHARS;

  for (const rule of rules) {
    if (budget <= 0) break;
    const label = relative(root, rule.path) || rule.path;
    const body =
      rule.content.length > budget
        ? rule.content.slice(0, budget) + '\n... [rule file truncated]'
        : rule.content;
    budget -= body.length;
    sections.push(`--- ${label} ---\n${body.trim()}`);
  }

  return (
    '\n\nProject rules (from this repository — follow them over your defaults):\n\n' +
    sections.join('\n\n')
  );
}

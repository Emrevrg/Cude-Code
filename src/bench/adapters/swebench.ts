import { existsSync, readFileSync } from 'fs';
import type { BenchTask, BenchTaskResult } from '../types.js';

/**
 * SWE-bench (and SWE-bench Verified) adapter.
 *
 * This harness does **not** grade SWE-bench. Grading requires the official
 * Docker evaluation images, and a score produced any other way is not the
 * score people mean when they quote one. What Cude does here is the half that
 * is actually its job: run the agent on each instance and emit a
 * `predictions.jsonl` in the format the official evaluator consumes.
 *
 *   cude bench swebench --dataset swe-bench-verified.jsonl --limit 25
 *   python -m swebench.harness.run_evaluation \
 *     --predictions_path .cude-bench/<run>/predictions.jsonl \
 *     --run_id cude-v0 --dataset_name princeton-nlp/SWE-bench_Verified
 *
 * The number that comes back from that command is a number worth publishing.
 */

export interface SweBenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  version?: string;
}

/** Reads JSONL, a JSON array, or a `{ "instances": [...] }` wrapper. */
export function loadSweBenchDataset(path: string): SweBenchInstance[] {
  if (!existsSync(path)) {
    throw new Error(
      `Dataset not found: ${path}\n` +
      `Download SWE-bench Verified from https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified ` +
      `and pass the .jsonl file with --dataset.`
    );
  }

  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return [];

  if (raw.startsWith('[') || raw.startsWith('{"instances"')) {
    const parsed = JSON.parse(raw) as SweBenchInstance[] | { instances: SweBenchInstance[] };
    return Array.isArray(parsed) ? parsed : parsed.instances;
  }

  return raw
    .split('\n')
    .filter(line => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as SweBenchInstance;
      } catch (err) {
        throw new Error(`Line ${index + 1} of ${path} is not valid JSON: ${err instanceof Error ? err.message : err}`);
      }
    });
}

export interface SweBenchOptions {
  /** A directory of pre-cloned repositories, keyed `<owner>__<name>`. Avoids re-cloning. */
  repoCache?: string;
  limit?: number;
  /** Only instances whose id matches. */
  filter?: string;
}

const PROMPT_PREFIX = `You are fixing a real issue in a real repository. The repository is checked out at the
commit where the issue was reported, and its tests are already installed.

Work as follows: reproduce or locate the failure first, then make the smallest change that fixes it.
Do not modify tests. Do not add new dependencies. When you are done, the working tree diff is your
answer, so leave no debugging output, no stray files and no commented-out code behind.

--- issue ---
`;

export function sweBenchTasks(
  instances: SweBenchInstance[],
  options: SweBenchOptions = {}
): BenchTask[] {
  const filtered = options.filter
    ? instances.filter(i => new RegExp(options.filter as string, 'i').test(i.instance_id))
    : instances;
  const limited = options.limit ? filtered.slice(0, options.limit) : filtered;

  return limited.map(instance => {
    const cacheKey = instance.repo.replace('/', '__');
    const source = options.repoCache
      ? `"${options.repoCache.replace(/\\/g, '/')}/${cacheKey}"`
      : `https://github.com/${instance.repo}.git`;

    return {
      id: instance.instance_id,
      suite: 'swebench',
      prompt: PROMPT_PREFIX + instance.problem_statement.trim(),
      setup: [
        `git clone --quiet ${source} .`,
        `git checkout --quiet ${instance.base_commit}`,
      ],
      // The only thing this harness can honestly check is that the agent
      // produced a patch. Whether the patch *fixes* the issue is what the
      // official evaluator decides.
      verify: { kind: 'command', command: 'git diff --quiet; if [ $? -eq 0 ]; then exit 1; else exit 0; fi' },
      maxIterations: 40,
      timeoutMs: 20 * 60 * 1000,
      tags: ['swebench'],
      meta: {
        collectPatch: true,
        instance_id: instance.instance_id,
        repo: instance.repo,
        base_commit: instance.base_commit,
      },
    };
  });
}

/** One line per instance, in the shape `swebench.harness.run_evaluation` expects. */
export function toPredictionsJsonl(results: BenchTaskResult[], modelName: string): string {
  return results
    .filter(result => result.patch && result.patch.trim().length > 0)
    .map(result =>
      JSON.stringify({
        instance_id: (result.meta?.instance_id as string) ?? result.taskId,
        model_name_or_path: modelName,
        model_patch: result.patch,
      })
    )
    .join('\n');
}

import type { AgentStopReason, AgentTelemetry } from '../core/agent.js';

/**
 * The benchmark harness.
 *
 * Cude has published no verified score on any independent leaderboard, and
 * writing one into the README would be worse than having none. What was
 * missing is the thing that produces a score in the first place: a harness
 * that runs the real agent against real tasks and grades the result by
 * something other than the model's own claim of success.
 *
 * Three deliberate constraints:
 *
 *   1. **Grading is independent of the agent.** A verifier is a command run
 *      after the agent has stopped, in the task's own directory, through the
 *      shell — not through the agent's tools. The agent cannot influence its
 *      own mark except by changing the files.
 *   2. **Every run is labelled with its provenance.** A local suite run is not
 *      a SWE-bench score, and the harness will not let a report imply that it
 *      is. Official numbers come from the official evaluators; for SWE-bench
 *      this harness emits `predictions.jsonl` for them to grade.
 *   3. **Sandboxed.** Each task runs in its own temp directory with the
 *      workspace root pointed at it, so a task cannot touch the machine or
 *      another task.
 */

export type Verifier =
  /** Passes when the command exits 0. The workhorse: `node --test`, `pytest`, `make`. */
  | { kind: 'command'; command: string; timeoutMs?: number }
  /** Passes when the file exists and matches the pattern. */
  | { kind: 'file_matches'; path: string; pattern: string; flags?: string }
  | { kind: 'file_exists'; path: string }
  | { kind: 'file_absent'; path: string }
  /**
   * Writes `content` to `path` before the rest of the grading runs, and always
   * passes. This is how a task whose grade depends on a test file survives an
   * agent that edits or deletes that file: the grader restores the original
   * before running it. Done in-process rather than as a shell command, because
   * embedding a file's contents in a command line is a quoting minefield.
   */
  | { kind: 'restore_file'; path: string; content: string }
  /** Passes only when every child passes. */
  | { kind: 'all'; of: Verifier[] };

export interface BenchTask {
  id: string;
  /** Which suite it came from, for grouping in the report. */
  suite: string;
  /** The instruction handed to the agent, verbatim. */
  prompt: string;
  /** Files written into the sandbox before the agent starts. */
  files?: Record<string, string>;
  /** Commands run in the sandbox before the agent starts (setup, install, checkout). */
  setup?: string[];
  /** How the result is graded. */
  verify: Verifier;
  /** Handed to the agent as its own verification command, when the task allows it. */
  agentVerifyCommand?: string;
  maxIterations?: number;
  timeoutMs?: number;
  tags?: string[];
  /** Free-form data an adapter needs when collecting results (e.g. instance_id). */
  meta?: Record<string, unknown>;
}

export interface BenchTaskResult {
  taskId: string;
  suite: string;
  passed: boolean;
  /** Why it failed, when it did: the verifier output or the harness error. */
  detail?: string;
  stopReason: AgentStopReason | 'error' | 'timeout';
  iterations: number;
  durationMs: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  telemetry?: AgentTelemetry;
  /** The unified diff the agent produced, when the task tracked one. */
  patch?: string;
  meta?: Record<string, unknown>;
}

/**
 * How much a report is allowed to claim.
 *
 * `local` is this harness grading its own suite — useful, reproducible, and
 * not comparable to anything published. `unofficial` is a public dataset run
 * through this harness rather than its official evaluator: indicative only.
 * `official` requires the dataset's own evaluator to have produced the grade,
 * which for SWE-bench means the Docker harness and for Terminal-Bench means
 * the `tb` runner.
 */
export type Provenance = 'local' | 'unofficial' | 'official';

export interface BenchRun {
  suite: string;
  provenance: Provenance;
  startedAt: string;
  finishedAt: string;
  provider: string;
  model: string;
  mode: string;
  /** Cude version the run was produced with. */
  version: string;
  results: BenchTaskResult[];
  summary: BenchSummary;
  /** Why this run cannot be quoted as an official score, when it cannot. */
  caveat?: string;
}

export interface BenchSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalCost: number;
  totalIterations: number;
  medianDurationMs: number;
  toolCalls: number;
  toolErrors: number;
  repairedCalls: number;
  compactions: number;
}

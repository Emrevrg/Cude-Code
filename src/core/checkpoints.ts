import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, unlinkSync, statSync } from 'fs';
import { join, resolve, dirname, relative } from 'path';
import { randomUUID } from 'crypto';
import { getDataDir } from '../config/index.js';
import { getWorkspaceRoot } from './tools.js';

/**
 * Undo for agent edits.
 *
 * The workspace boundary stops the agent writing somewhere it shouldn't; it
 * does nothing about a wrong edit inside the boundary. Before each mutating
 * tool call the prior state of the target is recorded, so a run can be put back
 * the way it was without needing the project to be a git repository (and
 * without touching git if it is — an agent run is not a commit).
 *
 * Snapshots are whole prior file contents. That is wasteful for large files and
 * completely reliable, which is the right trade for an undo path.
 */

/** Tools that change a file, and the argument naming what they change. */
export const MUTATING_TOOLS: Record<string, string> = {
  write_file: 'path',
  replace_in_file: 'path',
  apply_patch: 'path',
  delete_file: 'path',
  move_file: 'destination',
  copy_file: 'destination',
};

/** Files above this are recorded as "too large to snapshot" rather than copied. */
export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export interface FileSnapshot {
  path: string;
  /** Prior contents, or null when the file did not exist yet. */
  content: string | null;
  /** True when the file existed but was too large to capture. */
  skipped?: boolean;
}

export interface Checkpoint {
  id: string;
  runId: string;
  createdAt: string;
  /** The tool call this checkpoint precedes. */
  toolName: string;
  task: string;
  files: FileSnapshot[];
}

function checkpointDir(): string {
  const dir = join(getDataDir(), 'checkpoints');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function checkpointPath(id: string): string {
  return join(checkpointDir(), `${id}.json`);
}

/** Capture the current state of `filePath` before something changes it. */
export function snapshotFile(filePath: string): FileSnapshot {
  const target = resolve(filePath);
  if (!existsSync(target)) {
    return { path: target, content: null };
  }
  try {
    if (statSync(target).size > MAX_SNAPSHOT_BYTES) {
      return { path: target, content: null, skipped: true };
    }
    return { path: target, content: readFileSync(target, 'utf-8') };
  } catch {
    return { path: target, content: null, skipped: true };
  }
}

/**
 * Records the pre-state for one tool call. Returns null when the call does not
 * change a file, so callers can use it unconditionally.
 */
export function recordCheckpoint(
  runId: string,
  task: string,
  toolName: string,
  args: Record<string, unknown>
): Checkpoint | null {
  const pathArg = MUTATING_TOOLS[toolName];
  if (!pathArg) return null;

  const files: FileSnapshot[] = [];
  const target = args[pathArg];
  if (typeof target === 'string') files.push(snapshotFile(target));

  // move_file empties its source as well as writing its destination.
  if (toolName === 'move_file' && typeof args.source === 'string') {
    files.push(snapshotFile(args.source));
  }

  if (files.length === 0) return null;

  const checkpoint: Checkpoint = {
    id: randomUUID().slice(0, 8),
    runId,
    createdAt: new Date().toISOString(),
    toolName,
    task,
    files,
  };

  try {
    writeFileSync(checkpointPath(checkpoint.id), JSON.stringify(checkpoint, null, 2), 'utf-8');
  } catch {
    // A checkpoint that cannot be written must not stop the run.
    return null;
  }
  return checkpoint;
}

export function loadCheckpoint(id: string): Checkpoint | undefined {
  const path = checkpointPath(id);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Checkpoint;
  } catch {
    return undefined;
  }
}

export function listCheckpoints(): Checkpoint[] {
  const dir = checkpointDir();
  const entries = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : [];
  const checkpoints: Checkpoint[] = [];
  for (const entry of entries) {
    try {
      checkpoints.push(JSON.parse(readFileSync(join(dir, entry), 'utf-8')) as Checkpoint);
    } catch {
      // Skip anything unreadable rather than failing the whole listing.
    }
  }
  return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface RestoreResult {
  restored: string[];
  removed: string[];
  failed: Array<{ path: string; reason: string }>;
}

/**
 * Puts every file in the checkpoint back to its recorded state: rewritten if it
 * existed, deleted if it did not. Restoring is itself checkpointed by the
 * caller if it wants to be able to undo the undo.
 */
export function restoreCheckpoint(checkpoint: Checkpoint): RestoreResult {
  const result: RestoreResult = { restored: [], removed: [], failed: [] };

  for (const file of checkpoint.files) {
    if (file.skipped) {
      result.failed.push({ path: file.path, reason: 'not captured (too large)' });
      continue;
    }
    try {
      if (file.content === null) {
        // It did not exist before the tool ran, so undoing means removing it.
        if (existsSync(file.path)) {
          unlinkSync(file.path);
          result.removed.push(file.path);
        }
      } else {
        const dir = dirname(file.path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(file.path, file.content, 'utf-8');
        result.restored.push(file.path);
      }
    } catch (err) {
      result.failed.push({
        path: file.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/** Restores every checkpoint of a run, newest first, undoing the whole run. */
export function restoreRun(runId: string): RestoreResult {
  const merged: RestoreResult = { restored: [], removed: [], failed: [] };
  for (const checkpoint of listCheckpoints().filter(c => c.runId === runId)) {
    const result = restoreCheckpoint(checkpoint);
    merged.restored.push(...result.restored);
    merged.removed.push(...result.removed);
    merged.failed.push(...result.failed);
  }
  return merged;
}

/** Drops checkpoints older than `keep` most recent runs. */
export function pruneCheckpoints(keepRuns = 20): number {
  const all = listCheckpoints();
  const runs: string[] = [];
  for (const c of all) if (!runs.includes(c.runId)) runs.push(c.runId);

  const doomed = new Set(runs.slice(keepRuns));
  let removed = 0;
  for (const checkpoint of all) {
    if (!doomed.has(checkpoint.runId)) continue;
    try {
      rmSync(checkpointPath(checkpoint.id), { force: true });
      removed++;
    } catch {
      // Best-effort cleanup.
    }
  }
  return removed;
}

export function clearCheckpoints(): number {
  const all = listCheckpoints();
  for (const checkpoint of all) {
    try {
      rmSync(checkpointPath(checkpoint.id), { force: true });
    } catch {
      // Best-effort.
    }
  }
  return all.length;
}

/** Workspace-relative path for display. */
export function displayPath(path: string): string {
  const rel = relative(getWorkspaceRoot(), path);
  return rel && !rel.startsWith('..') ? rel : path;
}

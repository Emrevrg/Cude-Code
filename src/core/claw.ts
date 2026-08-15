import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDataDir } from '../config/index.js';
import { runAgent, type AgentResult } from './agent.js';
import type { TaskType } from './selector.js';

export type ClawJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface ClawJob {
  id: string;
  task: string;
  status: ClawJobStatus;
  createdAt: string;
  updatedAt: string;
  provider?: string;
  model?: string;
  taskType?: TaskType;
  maxIterations: number;
  attempts: number;
  result?: { success: boolean; output: string; stopReason: string; iterations: number; totalCost: number };
  error?: string;
}

function path(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'claw-jobs.json');
}
function read(): ClawJob[] {
  try { return JSON.parse(readFileSync(path(), 'utf8')) as ClawJob[]; } catch { return []; }
}
function write(jobs: ClawJob[]): void { writeFileSync(path(), JSON.stringify(jobs, null, 2), 'utf8'); }
export function listClawJobs(): ClawJob[] { return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function enqueueClawJob(input: Pick<ClawJob, 'task' | 'provider' | 'model' | 'taskType' | 'maxIterations'>): ClawJob {
  const now = new Date().toISOString();
  const job: ClawJob = { id: uuidv4(), task: input.task, status: 'queued', createdAt: now, updatedAt: now, provider: input.provider, model: input.model, taskType: input.taskType ?? 'code', maxIterations: input.maxIterations ?? 10, attempts: 0 };
  write([...read(), job]); return job;
}
export function cancelClawJob(id: string): boolean {
  const jobs = read(); const job = jobs.find(item => item.id === id || item.id.startsWith(id));
  if (!job || !['queued', 'failed'].includes(job.status)) return false;
  job.status = 'cancelled'; job.updatedAt = new Date().toISOString(); write(jobs); return true;
}
async function execute(job: ClawJob): Promise<AgentResult> {
  job.status = 'running'; job.attempts += 1; job.updatedAt = new Date().toISOString(); write(read().map(item => item.id === job.id ? job : item));
  return runAgent({ task: job.task, provider: job.provider, model: job.model, taskType: job.taskType, maxIterations: job.maxIterations, verbose: false, onConfirm: async () => true });
}
export async function processClawOnce(): Promise<ClawJob | null> {
  const job = read().find(item => item.status === 'queued' || item.status === 'failed');
  if (!job) return null;
  try {
    const result = await execute(job);
    job.status = result.success ? 'completed' : 'failed';
    job.result = { success: result.success, output: result.output, stopReason: result.stopReason, iterations: result.iterations, totalCost: result.totalCost };
    job.error = result.success ? undefined : result.stopReason;
  } catch (error) { job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error); }
  job.updatedAt = new Date().toISOString();
  write(read().map(item => item.id === job.id ? job : item));
  return job;
}
export async function runClawDaemon(options: { intervalMs: number; once?: boolean; signal?: AbortSignal }): Promise<void> {
  do {
    const job = await processClawOnce();
    if (options.once || !job) { if (options.once) return; }
    if (!options.once) await new Promise(resolve => setTimeout(resolve, options.intervalMs));
  } while (!options.signal?.aborted);
}

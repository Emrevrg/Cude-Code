/**
 * Voting / ensemble — sends the same prompt to multiple configured providers
 * in parallel, then returns all responses ranked by quality.
 *
 * Quality heuristic (no extra API call needed):
 *   - Penalise very short responses (< 50 chars)
 *   - Penalise obvious error messages
 *   - Reward structured responses (bullet points, code blocks)
 *   - Reward longer responses up to a cap
 */

import { getConfiguredProviders } from '../providers/index.js';
import { recordSpending } from '../storage/budget.js';
import type { Message, ChatResponse, Provider } from '../providers/types.js';

export interface VoteCandidate {
  provider: string;
  providerDisplayName: string;
  model: string;
  content: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  score: number;
  error?: string;
}

export interface VoteResult {
  winner: VoteCandidate;
  all: VoteCandidate[];
  totalCost: number;
}

// ─── Simple quality scorer ────────────────────────────────────────────────────

function scoreResponse(content: string): number {
  if (!content || content.length < 20) return 0;

  let score = 0;

  // Length score (logarithmic, caps at ~2000 chars)
  score += Math.min(Math.log10(content.length + 1) * 20, 40);

  // Structure bonuses
  if (content.includes('```')) score += 15;           // has code block
  if (/^[-•*]\s/m.test(content)) score += 8;          // has bullet list
  if (/^\d+\.\s/m.test(content)) score += 8;          // has numbered list
  if (content.includes('\n\n')) score += 5;            // has paragraphs

  // Penalty for obvious error/refusal patterns
  if (/I (cannot|can't|am unable|don't have access)/i.test(content)) score -= 20;
  if (/error|exception|failed/i.test(content.slice(0, 100))) score -= 10;

  return Math.max(0, score);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runVote(
  messages: Message[],
  options: {
    maxProviders?: number;
    onProgress?: (msg: string) => void;
    systemPrompt?: string;
    maxTokens?: number;
  } = {}
): Promise<VoteResult> {
  const { maxProviders = 4, onProgress, systemPrompt, maxTokens = 2048 } = options;

  const providers = getConfiguredProviders()
    .filter(p => p.name !== 'ollama') // Ollama can be slow — skip unless only option
    .slice(0, maxProviders);

  // If nothing configured except Ollama, include it
  if (providers.length === 0) {
    providers.push(...getConfiguredProviders().slice(0, maxProviders));
  }

  if (providers.length === 0) {
    throw new Error('No providers configured. Run: cude setup');
  }

  onProgress?.(`Querying ${providers.length} model${providers.length > 1 ? 's' : ''} in parallel...`);

  // Fire all requests in parallel
  const tasks = providers.map(async (provider): Promise<VoteCandidate> => {
    const models = provider.listModels();
    const model = models[0]?.id ?? 'default';

    try {
      const response: ChatResponse = await provider.chat(
        messages,
        model,
        { systemPrompt, maxTokens, temperature: 0.7 }
      );

      if (response.cost > 0) {
        recordSpending(provider.name, model, response.cost, response.inputTokens, response.outputTokens);
      }

      return {
        provider: provider.name,
        providerDisplayName: provider.displayName,
        model,
        content: response.content,
        cost: response.cost,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        score: scoreResponse(response.content),
      };
    } catch (err) {
      return {
        provider: provider.name,
        providerDisplayName: provider.displayName,
        model,
        content: '',
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        score: -1,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const results = await Promise.all(tasks);

  // Sort by score descending — failed ones (score -1) go last
  const sorted = results.sort((a, b) => b.score - a.score);
  const successful = sorted.filter(r => !r.error);

  if (successful.length === 0) {
    throw new Error('All providers failed:\n' + results.map(r => `  ${r.providerDisplayName}: ${r.error}`).join('\n'));
  }

  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);

  return {
    winner: successful[0],
    all: sorted,
    totalCost,
  };
}

/**
 * Wraps fetch so a refused or unreachable endpoint reports something the user
 * can act on. Self-hosted providers (Ollama, vLLM, llama.cpp, LiteLLM) run on
 * localhost and are simply not running most of the time, and an unwrapped
 * failure surfaces as a bare "fetch failed" that names neither the service nor
 * the address.
 */
/**
 * Statuses worth trying again. 429 is a rate limit and 5xx is the provider
 * having a bad minute; both are transient, and both used to end an agent run
 * outright. A long run — a benchmark sweep, a large refactor — hits at least
 * one of them almost every time.
 */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/** Attempts after the first. `CUDE_MAX_RETRIES=0` turns retrying off. */
export function maxRetries(): number {
  const configured = Number(process.env.CUDE_MAX_RETRIES);
  return Number.isFinite(configured) && configured >= 0 ? configured : 3;
}

/** Exponential backoff with jitter, so parallel workers do not retry in lockstep. */
export function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)) {
    return Math.min(retryAfterSeconds * 1000, 60_000);
  }
  const base = Math.min(500 * 2 ** attempt, 16_000);
  return base + Math.floor(Math.random() * 250);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function fetchProvider(
  url: string,
  init: RequestInit | undefined,
  serviceName: string,
  hint: string
): Promise<Response> {
  const attempts = maxRetries();

  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      const response = await fetchOnce(url, init, serviceName, hint);
      if (attempt < attempts && RETRYABLE_STATUS.has(response.status)) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(backoffMs(attempt, Number.isFinite(retryAfter) ? retryAfter : undefined));
        continue;
      }
      return response;
    } catch (err) {
      // An unreachable host is retried too: a local server that is still
      // starting refuses the connection for a second or two.
      if (attempt >= attempts) throw err;
      await sleep(backoffMs(attempt));
    }
  }

  // Unreachable: the loop either returns or throws.
  return fetchOnce(url, init, serviceName, hint);
}

async function fetchOnce(
  url: string,
  init: RequestInit | undefined,
  serviceName: string,
  hint: string
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    const unreachable =
      cause === 'ECONNREFUSED' ||
      cause === 'ENOTFOUND' ||
      cause === 'EHOSTUNREACH' ||
      cause === 'ETIMEDOUT' ||
      (err instanceof TypeError && /fetch failed/i.test(err.message));

    if (unreachable) {
      let origin = url;
      try {
        origin = new URL(url).origin;
      } catch {
        // keep the full URL if it will not parse
      }
      throw new Error(`Cannot reach ${serviceName} at ${origin}. ${hint}`);
    }
    throw err;
  }
}

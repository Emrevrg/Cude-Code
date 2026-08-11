/**
 * Wraps fetch so a refused or unreachable endpoint reports something the user
 * can act on. Self-hosted providers (Ollama, vLLM, llama.cpp, LiteLLM) run on
 * localhost and are simply not running most of the time, and an unwrapped
 * failure surfaces as a bare "fetch failed" that names neither the service nor
 * the address.
 */
export async function fetchProvider(
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

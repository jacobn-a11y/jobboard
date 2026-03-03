/**
 * Fetch with retry and exponential backoff for transient network errors.
 * Retries on 5xx, 429, and network failures. Does not retry on 4xx (except 429).
 */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const parsedTimeoutMs = Number(process.env.HTTP_TIMEOUT_MS ?? "20000");
const DEFAULT_TIMEOUT_MS =
  Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
    ? Math.floor(parsedTimeoutMs)
    : 20000;

export async function fetchWithRetry(
  url: string | URL,
  options?: RequestInit,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  initialDelayMs: number = DEFAULT_INITIAL_DELAY_MS
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const requestOptions: RequestInit = { ...options };

      if (!requestOptions.signal && DEFAULT_TIMEOUT_MS > 0) {
        const controller = new AbortController();
        requestOptions.signal = controller.signal;
        timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      }

      const response = await fetch(url, requestOptions);
      if (timeoutId) clearTimeout(timeoutId);

      // Retry on 5xx or 429
      if (response.status >= 500 || response.status === 429) {
        if (attempt < maxRetries) {
          const delay = initialDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      return response;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

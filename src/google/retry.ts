export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  sleep?: (milliseconds: number) => void;
}

export interface GoogleApiErrorLike {
  code?: number;
  status?: number | string;
  message?: string;
  errors?: Array<{ reason?: string; domain?: string }>;
}

export function googleErrorCode(error: unknown): number | undefined {
  const candidate = (error ?? {}) as GoogleApiErrorLike & {
    details?: GoogleApiErrorLike;
    response?: { getResponseCode?: () => number };
  };
  const direct = candidate.code ?? candidate.status ?? candidate.details?.code ?? candidate.details?.status;
  if (typeof direct === 'number') return direct;
  if (typeof direct === 'string' && /^\d{3}$/.test(direct)) return Number(direct);
  if (typeof candidate.response?.getResponseCode === 'function') return candidate.response.getResponseCode();
  const match = String(candidate.message ?? candidate.details?.message ?? '').match(/\b(403|404|409|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : undefined;
}

export function isRetryableGoogleError(error: unknown): boolean {
  const candidate = (error ?? {}) as GoogleApiErrorLike;
  const details = (candidate as GoogleApiErrorLike & { details?: GoogleApiErrorLike }).details;
  const code = googleErrorCode(error) ?? candidate.status ?? details?.status;
  if (code === 429 || code === 500 || code === 502 || code === 503 || code === 504) return true;
  if (code === 'RESOURCE_EXHAUSTED' || code === 'INTERNAL' || code === 'UNAVAILABLE') return true;
  const message = String(candidate.message ?? details?.message ?? '');
  if (/rateLimitExceeded|rate limit|too many requests|backend error|service unavailable/i.test(message)) return true;
  return [...(candidate.errors ?? []), ...(details?.errors ?? [])].some((entry) => entry.reason === 'rateLimitExceeded');
}

/** Execute an API operation with a finite, jittered exponential backoff. */
export function withGoogleRetry<T>(operation: () => T, options: RetryOptions = {}): T {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 250);
  const maxDelayMs = Math.max(initialDelayMs, options.maxDelayMs ?? 4_000);
  const jitterRatio = Math.max(0, options.jitterRatio ?? 0.2);
  const sleep = options.sleep ?? ((milliseconds: number) => {
    // Apps Script has no portable async sleep; this branch is replaced by the
    // runtime adapter. Keeping it injectable also makes node tests deterministic.
    const utilities = (globalThis as any).Utilities;
    if (milliseconds > 0 && utilities) utilities.sleep(milliseconds);
  });

  for (let attempt = 1; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableGoogleError(error)) throw error;
      const base = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      const jitter = base * jitterRatio * (Math.random() * 2 - 1);
      sleep(Math.max(0, Math.round(base + jitter)));
    }
  }
}

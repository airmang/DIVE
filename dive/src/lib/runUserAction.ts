/**
 * Wraps an async user-triggered action so a failure is always surfaced
 * (toast, inline banner, …) instead of becoming a silent unhandled
 * rejection. DIVE's design principle is that failures are shown, never
 * swallowed — this is the one place that shape gets enforced.
 */
export async function runUserAction<T>(
  fn: () => Promise<T>,
  onError: (err: unknown) => void,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    onError(err);
    return { ok: false };
  }
}

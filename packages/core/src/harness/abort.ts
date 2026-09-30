/**
 * Timeout + caller-signal wiring shared by every adapter. No agent SDK imports.
 */

/**
 * Wire an optional timeout + caller signal onto a single AbortController.
 *
 * Returns undefined when neither a timeout nor a signal is supplied so the
 * default code path (no abortController, no timer) is byte-for-byte unchanged.
 *
 * `reason()` reports whether the abort came from the timeout timer or an
 * external signal, so callers can log a distinct timeout message.
 */
export function makeAbort(
  timeoutMs?: number,
  signal?: AbortSignal,
): { controller: AbortController; clear: () => void; reason: () => "timeout" | "signal" | undefined } | undefined {
  if (!timeoutMs && !signal) return undefined;

  const controller = new AbortController();
  let reason: "timeout" | "signal" | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onSignalAbort = () => {
    if (controller.signal.aborted) return;
    reason = "signal";
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      reason = "signal";
      controller.abort();
    } else {
      signal.addEventListener("abort", onSignalAbort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      reason = "timeout";
      controller.abort();
    }, timeoutMs);
    // Don't keep the event loop alive just for the abort timer.
    (timer as any)?.unref?.();
  }

  return {
    controller,
    reason: () => reason,
    clear: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onSignalAbort);
    },
  };
}

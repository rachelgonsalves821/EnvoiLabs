/** One monotonic deadline across private source checks, authorization and inference. */
export function analystDeadline(timeoutMs: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    return null;
  const endsAt = performance.now() + timeoutMs;
  return {
    expired: () => performance.now() >= endsAt,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const remaining = Math.ceil(endsAt - performance.now());
      if (remaining <= 0) throw new Error("Analyst draft deadline elapsed");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([operation(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Analyst draft deadline elapsed")), remaining);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    },
  };
}

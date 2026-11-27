// One UUID identifies the lifetime of this document's performance.now() clock.
// A reload creates a new module instance and therefore a new origin.
let originId: string | null = null;

export function browserProbeClockStamp() {
  originId ??= crypto.randomUUID();
  return { browserClockOriginId: originId, atMs: performance.now() };
}

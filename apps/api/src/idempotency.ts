export interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

export interface IdempotencyEntry<T> {
  fingerprint: string;
  value: T;
}

export class IdempotencyConflictError extends Error {
  public constructor() {
    super("clientRequestId was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export function getOrCreateIdempotent<T>(
  key: string | undefined,
  fingerprint: string,
  index: Map<string, IdempotencyEntry<T>>,
  create: () => T
): IdempotentResult<T> {
  if (key) {
    const existing = index.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError();
      return { value: existing.value, replayed: true };
    }
  }

  const value = create();
  if (key) index.set(key, { fingerprint, value });
  return { value, replayed: false };
}

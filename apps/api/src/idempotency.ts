export interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

export function getOrCreateIdempotent<T>(
  key: string | undefined,
  index: Map<string, T>,
  create: () => T
): IdempotentResult<T> {
  if (key) {
    const existing = index.get(key);
    if (existing !== undefined) return { value: existing, replayed: true };
  }

  const value = create();
  if (key) index.set(key, value);
  return { value, replayed: false };
}

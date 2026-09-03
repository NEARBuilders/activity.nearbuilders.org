export function mergeLiveActivityEvent<T extends { id: string }>(
  current: readonly T[],
  incoming: T,
  limit = 20,
): T[] {
  if (current.some(({ id }) => id === incoming.id)) return [...current];
  return [incoming, ...current].slice(0, limit);
}

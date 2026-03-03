export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;

      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(runners);
  return results;
}

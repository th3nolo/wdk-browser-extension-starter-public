export type MutationChain = {
  run: <T>(operation: () => Promise<T>) => Promise<T>;
  reset: () => void;
};

export function createMutationChain(): MutationChain {
  let chain: Promise<unknown> = Promise.resolve();

  function run<T>(operation: () => Promise<T>): Promise<T> {
    const next = chain.then(operation, operation);
    chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  function reset(): void {
    chain = Promise.resolve();
  }

  return { run, reset };
}

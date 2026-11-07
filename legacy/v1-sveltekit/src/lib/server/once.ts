export function once<T>(create: () => T): () => T {
  let value: T | undefined;
  return () => {
    if (value === undefined) {
      value = create();
    }
    return value;
  };
}

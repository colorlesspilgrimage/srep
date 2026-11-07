export type Env = Record<string, string | undefined>;

export function blankToUnset(value: string | undefined): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
}

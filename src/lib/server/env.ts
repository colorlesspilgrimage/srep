export type Env = Record<string, string | undefined>;

// A blank value counts as unset.
export function blankToUnset(value: string | undefined): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
}

import type { CardState } from '#lib/server/domain/store/store-types.js';

export function isParkedState(state: CardState): boolean {
  return state === 'suspended' || state === 'buried';
}

// Contract: pure check for a parked card state. A parked card is suspended or buried.
// Answer, undo and replay keep the parked state. The schedule state does not replace it.
import type { CardState } from '#lib/server/domain/store/store-types.js';

export function isParkedState(state: CardState): boolean {
  return state === 'suspended' || state === 'buried';
}

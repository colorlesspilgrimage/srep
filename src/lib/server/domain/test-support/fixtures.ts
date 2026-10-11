import { BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import type { PresetInput } from '#lib/server/domain/core/validation.js';

// A valid 1x1 transparent PNG (68 bytes).
export const PNG_HEX =
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082';

export const PNG = Buffer.from(PNG_HEX, 'hex');

export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');

// The default preset values without the id, as an API body.
export const PRESET_INPUT: PresetInput = {
  name: BUILTIN_PRESET.name,
  newPerDay: BUILTIN_PRESET.newPerDay,
  reviewsPerDay: BUILTIN_PRESET.reviewsPerDay,
  desiredRetention: BUILTIN_PRESET.desiredRetention,
  learningSteps: BUILTIN_PRESET.learningSteps,
  relearningSteps: BUILTIN_PRESET.relearningSteps,
  maxInterval: BUILTIN_PRESET.maxInterval,
  fsrsParams: BUILTIN_PRESET.fsrsParams,
  burySiblings: BUILTIN_PRESET.burySiblings,
  newOrder: BUILTIN_PRESET.newOrder,
};

import { sanitizeCardHtml } from '../legacy/v1-sveltekit/src/lib/client/card/sanitize-card.ts';
import {
  captureKeyEffect,
  chordFromEvent,
  closeHint,
  copyKeybindMap,
  DEFAULT_KEYBINDS,
  openHint,
  paletteKeyAction,
  PALETTE_CLOSE,
  PALETTE_OPEN,
  PALETTE_OPEN_COLON,
  remap,
} from '../legacy/v1-sveltekit/src/lib/client/tui/keymap.ts';
import { listKeyIndex } from '../legacy/v1-sveltekit/src/lib/client/tui/list-state.ts';
import { formatInterval } from '../legacy/v1-sveltekit/src/lib/client/app/format-interval.ts';
import { formatUntil } from '../legacy/v1-sveltekit/src/lib/client/app/format-until.ts';
import { studyKeyAction } from '../legacy/v1-sveltekit/src/lib/client/app/study-keys.ts';
import { fieldKeyEffect } from '../legacy/v1-sveltekit/src/lib/client/app/note-field-keys.ts';
import { deckListKey } from '../legacy/v1-sveltekit/src/lib/client/app/note-deck-keys.ts';
import { wrapCloze, nextClozeIndex } from '../legacy/v1-sveltekit/src/lib/client/app/cloze-edit.ts';
import {
  acceptDisplay,
  DEFAULT_DISPLAY,
  displayRootClass,
} from '../legacy/v1-sveltekit/src/lib/client/app/display-prefs.ts';
import { acceptStudyDay } from '../legacy/v1-sveltekit/src/lib/client/app/study-day-form.ts';
import {
  acceptPreset,
  BLANK_PRESET_DRAFT,
  copyDraft,
  draftFromPreset,
  presetMessageFor,
} from '../legacy/v1-sveltekit/src/lib/client/app/preset-form.ts';
import { commandsFor } from '../legacy/v1-sveltekit/src/lib/client/tui/keymap.ts';

export {
  sanitizeCardHtml,
  paletteKeyAction,
  openHint,
  closeHint,
  DEFAULT_KEYBINDS,
  chordFromEvent,
  remap,
  captureKeyEffect,
  copyKeybindMap,
  PALETTE_OPEN,
  PALETTE_OPEN_COLON,
  PALETTE_CLOSE,
  listKeyIndex,
  formatInterval,
  formatUntil,
  studyKeyAction,
  fieldKeyEffect,
  deckListKey,
  wrapCloze,
  nextClozeIndex,
  acceptDisplay,
  DEFAULT_DISPLAY,
  displayRootClass,
  acceptStudyDay,
  acceptPreset,
  BLANK_PRESET_DRAFT,
  copyDraft,
  draftFromPreset,
  presetMessageFor,
  commandsFor,
};

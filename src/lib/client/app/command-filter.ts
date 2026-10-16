// Contract: filter command names for the palette.
// Compare with an ASCII lower fold only. Codes 65 to 90 become 97 to 122.
// Do not use toLowerCase. A non-ASCII letter stays unchanged.
// An empty filter returns no rows.
// No I/O.

import { commandsFor } from '#lib/client/tui/keymap.js';

function asciiFold(text: string): string {
  let folded = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 65 && code <= 90) {
      folded += String.fromCharCode(code + 32);
    } else {
      folded += text.charAt(index);
    }
  }
  return folded;
}

export function filterCommands(commands: readonly string[], filter: string): string[] {
  const needle = asciiFold(filter.trim());
  if (needle === '') {
    return [];
  }
  return commands.filter((name) => asciiFold(name).includes(needle));
}

// Absent commands keep the gallery list. Present commands use filterCommands.
export function paletteNames(filter: string, commands: readonly string[] | undefined): string[] {
  if (filter.trim() === '') {
    return [];
  }
  if (commands === undefined) {
    return commandsFor(filter);
  }
  return filterCommands(commands, filter);
}

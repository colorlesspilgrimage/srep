import { findMediaTokens } from '#lib/server/domain/core/media-rules.js';
import type { NativeManifest } from '#lib/server/import-export/types.js';

// Every media token referenced in fields, templates, or listed in media rows.
export function referencedMediaShas(manifest: NativeManifest): string[] {
  const found = new Set<string>(manifest.media.map((row) => row.sha256));
  const scan = (text: string): void => {
    for (const sha of findMediaTokens(text)) {
      found.add(sha);
    }
  };
  for (const nt of manifest.noteTypes) {
    for (const template of nt.templates) {
      scan(template.frontTpl);
      scan(template.backTpl);
    }
  }
  for (const note of manifest.notes) {
    for (const field of note.fields) {
      scan(field);
    }
  }
  return [...found].sort();
}

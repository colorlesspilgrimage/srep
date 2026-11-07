import crypto from 'node:crypto';
import { BASIC_CARD_ID, BASIC_ID, DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import { fieldChecksum } from '#lib/server/domain/core/text.js';
import type { ImportExportDeps } from '#lib/server/import-export/deps.js';
import { applyPendingNative, countsOf } from '#lib/server/import-export/native.js';
import { stashPending } from '#lib/server/import-export/pending-imports.js';
import type {
  DryRunReport,
  ImportFormat,
  NativeManifest,
} from '#lib/server/import-export/types.js';
import { NATIVE_MANIFEST_VERSION } from '#lib/server/import-export/types.js';

type CsvColumnMap = {
  deckPath: number;
  fieldColumns: number[];
  tagColumn: number | null;
  noteTypeName: string | null;
};

function splitRow(line: string, format: 'csv' | 'tsv'): string[] {
  if (format === 'tsv') {
    return line.split('\t');
  }
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index] ?? '';
    if (quoted) {
      if (ch === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

function mapColumns(header: string[]): CsvColumnMap | { error: string } {
  const deck = header.findIndex((name) => /^deck$/i.test(name));
  const tag = header.findIndex((name) => /^tags?$/i.test(name));
  const fieldCols = header
    .map((name, index) =>
      /^field\d+$/i.test(name) || /^front$/i.test(name) || /^back$/i.test(name) ? index : -1,
    )
    .filter((index) => index >= 0);
  if (deck < 0 || fieldCols.length === 0) {
    return { error: 'bad_csv_header' };
  }
  const typeCol = header.findIndex((name) => /^notetype$/i.test(name));
  return {
    deckPath: deck,
    fieldColumns: fieldCols.sort((a, b) => a - b),
    tagColumn: tag >= 0 ? tag : null,
    noteTypeName: typeCol >= 0 ? null : 'Basic',
  };
}

function manifestFromCsv(
  text: string,
  format: 'csv' | 'tsv',
  deps: ImportExportDeps,
  warnings: string[],
): NativeManifest | { error: string } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { error: 'csv_empty' };
  }
  const header = splitRow(lines[0] ?? '', format);
  const mapped = mapColumns(header);
  if ('error' in mapped) {
    return mapped;
  }

  const now = deps.now();
  const defaultDeckId = crypto.randomUUID();
  const decks: NativeManifest['decks'] = [
    {
      id: defaultDeckId,
      parentId: null,
      name: 'Imported',
      path: 'Imported',
      presetId: DEFAULT_PRESET_ID,
      description: '',
      archivedAt: null,
    },
  ];

  const notes: NativeManifest['notes'] = [];
  const cards: NativeManifest['cards'] = [];
  const noteTags: NativeManifest['noteTags'] = [];

  const pathToDeck = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const cols = splitRow(line, format);
    const deckPath = cols[mapped.deckPath]?.trim() ?? 'Imported';
    let deckId = pathToDeck.get(deckPath);
    if (deckId === undefined) {
      deckId = crypto.randomUUID();
      pathToDeck.set(deckPath, deckId);
      const segments = deckPath.split('::');
      decks.push({
        id: deckId,
        parentId: deckPath.includes('::')
          ? (pathToDeck.get(deckPath.split('::').slice(0, -1).join('::')) ?? null)
          : null,
        name: segments.at(-1) ?? deckPath,
        path: deckPath,
        presetId: DEFAULT_PRESET_ID,
        description: '',
        archivedAt: null,
      });
    }
    const fields = mapped.fieldColumns.map((index) => cols[index] ?? '');
    const noteId = crypto.randomUUID();
    const checksum = fieldChecksum(fields[0] ?? '');
    notes.push({
      id: noteId,
      noteTypeId: BASIC_ID,
      guid: crypto.randomBytes(12).toString('base64url'),
      fields,
      createdAt: now,
      updatedAt: now,
      checksum,
      deletedAt: null,
    });
    const templateId = BASIC_CARD_ID;
    cards.push({
      id: crypto.randomUUID(),
      noteId,
      templateId,
      ordinal: 0,
      deckId,
      state: 'new',
      due: now,
      stability: 0,
      difficulty: 0,
      lastReview: null,
      reps: 0,
      lapses: 0,
      position: cards.length,
      buriedUntil: null,
      flags: 0,
      schedState: 'new',
      learningStep: 0,
    });
    if (mapped.tagColumn !== null) {
      const raw = cols[mapped.tagColumn] ?? '';
      for (const tag of raw
        .split(' ')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)) {
        noteTags.push({ noteId, tag });
      }
    }
  }

  if (decks.length === 0) {
    warnings.push('No deck column values found; used Imported deck.');
  }

  return {
    version: NATIVE_MANIFEST_VERSION,
    exportedAt: now,
    presets: [],
    decks,
    noteTypes: [],
    notes,
    noteTags,
    cards,
    reviewLogs: [],
    media: [],
    appSettings: [],
  };
}

export async function planCsvImport(
  deps: ImportExportDeps,
  bytes: Uint8Array,
  format: ImportFormat,
): Promise<DryRunReport | { error: string }> {
  if (format !== 'csv' && format !== 'tsv') {
    return { error: 'unknown_format' };
  }
  const warnings: string[] = [];
  const text = Buffer.from(bytes).toString('utf8');
  const manifest = manifestFromCsv(text, format, deps, warnings);
  if ('error' in manifest) {
    return { error: manifest.error };
  }
  const token = stashPending({ format, manifest, mediaFiles: new Map(), warnings }, deps.now());
  return {
    format,
    summary: format === 'tsv' ? 'Tab-separated notes.' : 'Comma-separated notes.',
    warnings,
    conflicts: [],
    wouldImport: countsOf(manifest),
    importToken: token,
  };
}

export async function applyPendingCsv(
  deps: ImportExportDeps,
  manifest: NativeManifest,
): Promise<void> {
  await applyPendingNative(deps, manifest, new Map());
}

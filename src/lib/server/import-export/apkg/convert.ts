import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { sniffMime } from '#lib/server/domain/core/media-rules.js';
import { BUILTIN_NOTE_TYPES, DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import type { ApkgBundle } from '#lib/server/import-export/apkg/open.js';
import { NATIVE_MANIFEST_VERSION, type NativeManifest } from '#lib/server/import-export/types.js';

type AnkiModel = {
  id: number;
  name: string;
  type: number;
  flds: { name: string }[];
  tmpls: { name: string; ord: number; qfmt: string; afmt: string }[];
  css?: string;
};

type AnkiDeck = {
  id: number;
  name: string;
  desc?: string;
};

const FIELD_SEP = '\u001f';

function uuid(): string {
  return crypto.randomUUID();
}

function stableGuid(ankiGuid: string): string {
  return ankiGuid.length > 0 ? ankiGuid : uuid();
}

// Strips Anki-only tokens. Unsupported pieces become warnings, not errors.
export function convertAnkiTemplate(source: string, warnings: string[]): string {
  let out = source;
  if (out.includes('{{FrontSide}}') || out.includes('{{#') || /\{\{[^}]+\}\}/.test(out)) {
    if (/{{[^}]*:[^}]+}}/.test(out) || out.includes('<script')) {
      warnings.push('Dropped Anki template filters or scripts.');
    }
  }
  out = out.replaceAll('{{FrontSide}}', '');
  out = out.replaceAll(/\{\{#[^}]+\}\}/g, '');
  out = out.replaceAll(/\{\{\/[^}]+\}\}/g, '');
  out = out.replaceAll(/\{\{[^}:]+:[^}]+\}\}/g, (match) => {
    const inner = match.slice(2, -2);
    const colon = inner.indexOf(':');
    const name = colon === -1 ? inner : inner.slice(colon + 1);
    return `{{${name.trim()}}}`;
  });
  return out;
}

function readColJson(db: Database.Database, column: string): Record<string, unknown> {
  const row = db.prepare(`select ${column} from col`).get() as Record<string, string> | undefined;
  if (row === undefined) {
    return {};
  }
  const text = row[column];
  if (typeof text !== 'string' || text.length === 0) {
    return {};
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function deckRows(decksJson: Record<string, AnkiDeck>, presetId: string): NativeManifest['decks'] {
  const byPath = new Map<string, NativeManifest['decks'][number]>();
  const rows: NativeManifest['decks'] = [];
  const paths = [...new Set(Object.values(decksJson).map((deck) => deck.name))].sort();
  for (const path of paths) {
    const segments = path.split('::');
    let parentId: string | null = null;
    let built = '';
    for (const segment of segments) {
      built = built === '' ? segment : `${built}::${segment}`;
      if (byPath.has(built)) {
        parentId = byPath.get(built)?.id ?? null;
        continue;
      }
      const id = uuid();
      const row = {
        id,
        parentId,
        name: segment,
        path: built,
        presetId,
        description: '',
        archivedAt: null,
      };
      byPath.set(built, row);
      rows.push(row);
      parentId = id;
    }
  }
  return rows;
}

function noteTypesFromModels(
  models: Record<string, AnkiModel>,
  warnings: string[],
): { noteTypes: NativeManifest['noteTypes']; modelToType: Map<number, string> } {
  const noteTypes: NativeManifest['noteTypes'] = [];
  const modelToType = new Map<number, string>();
  for (const [key, model] of Object.entries(models)) {
    const mid = Number(key);
    const builtin = BUILTIN_NOTE_TYPES.find((row) => row.noteType.name === model.name);
    const typeId = builtin?.noteType.id ?? uuid();
    modelToType.set(mid, typeId);
    if (builtin !== undefined) {
      continue;
    }
    const fields = model.flds.map((field) => field.name).filter((name) => name.length > 0);
    const templates = model.tmpls.map((template, index) => ({
      id: uuid(),
      noteTypeId: typeId,
      name: template.name,
      ordinal: template.ord ?? index,
      frontTpl: convertAnkiTemplate(template.qfmt, warnings),
      backTpl: convertAnkiTemplate(template.afmt, warnings),
    }));
    noteTypes.push({
      noteType: {
        id: typeId,
        name: model.name,
        fields: fields.length > 0 ? fields : ['Front', 'Back'],
        cssClass: model.name.toLowerCase().replaceAll(/\s+/g, '-').slice(0, 40),
        sortFieldIdx: 0,
      },
      templates,
    });
  }
  return { noteTypes, modelToType };
}

function rewriteMediaRefs(text: string, fileToSha: Map<string, string>): string {
  return text.replaceAll(/src="([^"]+)"/g, (match, name: string) => {
    const sha = fileToSha.get(name);
    return sha === undefined ? match : `src="{{media:${sha}}}"`;
  });
}

export function convertApkgToManifest(
  db: Database.Database,
  bundle: ApkgBundle,
  warnings: string[],
  now: number,
): { manifest: NativeManifest; mediaFiles: Map<string, Buffer> } {
  const modelsRaw = readColJson(db, 'models');
  const decksRaw = readColJson(db, 'decks');
  const models = modelsRaw as Record<string, AnkiModel>;
  const decks = decksRaw as Record<string, AnkiDeck>;

  const presetId = DEFAULT_PRESET_ID;
  const { noteTypes, modelToType } = noteTypesFromModels(models, warnings);
  const deckList = deckRows(decks, presetId);

  const pathToId = new Map(deckList.map((row) => [row.path, row.id]));
  const deckIdByAnki = new Map<number, string>();
  for (const [key, deck] of Object.entries(decks)) {
    const ankiId = Number(key);
    const srepId = pathToId.get(deck.name);
    if (srepId !== undefined) {
      deckIdByAnki.set(ankiId, srepId);
    }
  }

  const mediaRows: NativeManifest['media'] = [];
  const fileToSha = new Map<string, string>();
  const mediaFiles = new Map<string, Buffer>();
  for (const [index, fileName] of Object.entries(bundle.mediaMap)) {
    const file = bundle.entries.get(index);
    if (file === undefined || fileName.length === 0) {
      continue;
    }
    const sha = crypto.createHash('sha256').update(file).digest('hex');
    const mime = sniffMime(file);
    if (mime === null) {
      warnings.push(`Skipped unsupported media type for ${fileName}.`);
      continue;
    }
    fileToSha.set(fileName, sha);
    mediaFiles.set(sha, file);
    mediaRows.push({
      id: uuid(),
      sha256: sha,
      mime,
      size: file.byteLength,
      originalName: fileName,
    });
  }

  const notesRaw = db.prepare('select id, guid, mid, flds, tags from notes').all() as {
    id: number;
    guid: string;
    mid: number;
    flds: string;
    tags: string;
  }[];

  const templateByType = new Map<string, NativeManifest['noteTypes'][number]['templates']>();
  for (const nt of noteTypes) {
    templateByType.set(nt.noteType.id, nt.templates);
  }

  const notes: NativeManifest['notes'] = [];
  const noteTags: NativeManifest['noteTags'] = [];
  const noteIdMap = new Map<number, string>();

  for (const row of notesRaw) {
    const noteTypeId = modelToType.get(row.mid);
    if (noteTypeId === undefined) {
      warnings.push(`Skipped note with unknown model ${row.mid}.`);
      continue;
    }
    const fields = row.flds.split(FIELD_SEP).map((field) => rewriteMediaRefs(field, fileToSha));
    const id = uuid();
    noteIdMap.set(row.id, id);
    const checksum = fields[0] ?? '';
    notes.push({
      id,
      noteTypeId,
      guid: stableGuid(row.guid),
      fields,
      createdAt: now,
      updatedAt: now,
      checksum,
      deletedAt: null,
    });
    const tags = row.tags
      .trim()
      .split(' ')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    for (const tag of tags) {
      noteTags.push({ noteId: id, tag });
    }
  }

  const cardsRaw = db
    .prepare('select id, nid, did, ord, due, ivl, factor, reps, lapses, queue, type from cards')
    .all() as {
    id: number;
    nid: number;
    did: number;
    ord: number;
    due: number;
    ivl: number;
    reps: number;
    lapses: number;
    queue: number;
    type: number;
  }[];

  const cards: NativeManifest['cards'] = [];
  let position = 0;
  for (const row of cardsRaw) {
    const noteId = noteIdMap.get(row.nid);
    const deckId = deckIdByAnki.get(row.did);
    const note = notes.find((n) => n.id === noteId);
    if (noteId === undefined || deckId === undefined || note === undefined) {
      continue;
    }
    let templates = templateByType.get(note.noteTypeId) ?? [];
    if (templates.length === 0) {
      const builtin = BUILTIN_NOTE_TYPES.find((row) => row.noteType.id === note.noteTypeId);
      templates = builtin?.templates ?? [];
    }
    const template = templates[row.ord] ?? templates[0];
    if (template === undefined) {
      continue;
    }
    const state =
      row.queue === 0 ? 'new' : row.queue === 1 || row.queue === 3 ? 'learning' : 'review';
    cards.push({
      id: uuid(),
      noteId,
      templateId: template.id,
      ordinal: row.ord,
      deckId,
      state,
      due: row.due > 1_000_000_000_000 ? row.due : row.due * 86_400_000 + now,
      stability: 0,
      difficulty: 0,
      lastReview: null,
      reps: row.reps,
      lapses: row.lapses,
      position: position++,
      buriedUntil: null,
      flags: 0,
      schedState: state === 'review' ? 'review' : state === 'learning' ? 'learning' : 'new',
      learningStep: 0,
    });
  }

  return {
    manifest: {
      version: NATIVE_MANIFEST_VERSION,
      exportedAt: now,
      presets: [],
      decks: deckList,
      noteTypes,
      notes,
      noteTags,
      cards,
      reviewLogs: [],
      media: mediaRows,
      appSettings: [],
    },
    mediaFiles,
  };
}

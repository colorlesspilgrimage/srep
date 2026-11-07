import type { JsonValue } from '#lib/server/db/schema/sqlite.js';
import type {
  CardRow,
  DeckRow,
  MediaRow,
  NoteRow,
  NoteTypeRow,
  PresetRow,
  TemplateRow,
} from '#lib/server/domain/store/store-types.js';
import type { ReviewLogRow } from '#lib/server/study/core/types.js';

export const NATIVE_MANIFEST_VERSION = 1 as const;

export type NativeManifest = {
  version: typeof NATIVE_MANIFEST_VERSION;
  exportedAt: number;
  presets: PresetRow[];
  decks: DeckRow[];
  noteTypes: { noteType: NoteTypeRow; templates: TemplateRow[] }[];
  notes: NoteRow[];
  noteTags: { noteId: string; tag: string }[];
  cards: CardRow[];
  reviewLogs: ReviewLogRow[];
  media: MediaRow[];
  appSettings: { key: string; value: JsonValue }[];
};

export type ImportCounts = {
  presets: number;
  decks: number;
  noteTypes: number;
  notes: number;
  cards: number;
  reviewLogs: number;
  media: number;
};

export type ImportFormat = 'native' | 'apkg' | 'csv' | 'tsv';

export type DryRunReport = {
  format: ImportFormat;
  summary: string;
  warnings: string[];
  conflicts: string[];
  wouldImport: ImportCounts;
  importToken: string;
};

export type PendingImport = {
  format: ImportFormat;
  expiresAt: number;
  manifest: NativeManifest;
  mediaFiles: Map<string, Buffer>;
  warnings: string[];
};

export type ExportFormat = 'native' | 'apkg' | 'csv' | 'tsv' | 'text';

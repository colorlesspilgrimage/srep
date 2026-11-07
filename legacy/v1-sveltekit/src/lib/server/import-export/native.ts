import { nativeManifestSchema } from '#lib/server/import-export/manifest-schema.js';
import { referencedMediaShas } from '#lib/server/import-export/collect-media.js';
import type { ImportExportDeps } from '#lib/server/import-export/deps.js';
import { stashPending } from '#lib/server/import-export/pending-imports.js';
import type {
  DryRunReport,
  ImportCounts,
  NativeManifest,
} from '#lib/server/import-export/types.js';
import { packNativeArchive, unpackNativeArchive } from '#lib/server/import-export/zip-archive.js';

export function countsOf(manifest: NativeManifest): ImportCounts {
  return {
    presets: manifest.presets.length,
    decks: manifest.decks.length,
    noteTypes: manifest.noteTypes.length,
    notes: manifest.notes.filter((n) => n.deletedAt === null).length,
    cards: manifest.cards.length,
    reviewLogs: manifest.reviewLogs.length,
    media: manifest.media.length,
  };
}

async function guidConflicts(deps: ImportExportDeps, manifest: NativeManifest): Promise<string[]> {
  const conflicts: string[] = [];
  for (const incoming of manifest.notes) {
    if (incoming.deletedAt !== null) {
      continue;
    }
    const state = await deps.domain.store.getNoteState(incoming.id);
    if (state !== undefined && state.note.guid !== incoming.guid) {
      conflicts.push(`note guid clash: ${incoming.guid}`);
    }
  }
  const decks = await deps.domain.store.listDecks();
  const paths = new Set(decks.map((d) => d.path));
  for (const deck of manifest.decks) {
    if (paths.has(deck.path)) {
      const existing = decks.find((d) => d.path === deck.path);
      if (existing !== undefined && existing.id !== deck.id) {
        conflicts.push(`deck path clash: ${deck.path}`);
      }
    }
  }
  return conflicts;
}

function missingMedia(manifest: NativeManifest, files: Map<string, Buffer>): string[] {
  const missing: string[] = [];
  for (const sha of referencedMediaShas(manifest)) {
    if (!files.has(sha)) {
      const listed = manifest.media.some((row) => row.sha256 === sha);
      if (listed) {
        missing.push(`missing media file: ${sha}`);
      }
    }
  }
  return missing;
}

export async function planNativeImport(
  deps: ImportExportDeps,
  bytes: Uint8Array,
): Promise<DryRunReport | { error: string }> {
  let manifest: NativeManifest;
  let files: Map<string, Buffer>;
  try {
    const unpacked = unpackNativeArchive(bytes);
    manifest = unpacked.manifest;
    files = unpacked.files;
  } catch {
    return { error: 'bad_archive' };
  }
  const parsed = nativeManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return { error: 'bad_manifest' };
  }
  manifest = parsed.data as NativeManifest;
  const warnings = missingMedia(manifest, files);
  const conflicts = await guidConflicts(deps, manifest);
  const now = deps.now();
  const token = stashPending({ format: 'native', manifest, mediaFiles: files, warnings }, now);
  return {
    format: 'native',
    summary: 'Native srep archive.',
    warnings,
    conflicts,
    wouldImport: countsOf(manifest),
    importToken: token,
  };
}

export async function exportNativeArchive(deps: ImportExportDeps): Promise<Buffer> {
  const exportedAt = deps.now();
  const manifest = await deps.snapshot.readSnapshot(exportedAt);
  const shas = referencedMediaShas(manifest);
  const media = new Map<string, Buffer>();
  for (const sha of shas) {
    const bytes = await deps.domain.media.read(sha);
    if (bytes !== null) {
      media.set(sha, bytes);
    }
  }
  return packNativeArchive(manifest, media);
}

export async function applyPendingNative(
  deps: ImportExportDeps,
  manifest: NativeManifest,
  mediaFiles: Map<string, Buffer>,
): Promise<void> {
  for (const sha of referencedMediaShas(manifest)) {
    const bytes = mediaFiles.get(sha);
    if (bytes !== undefined) {
      await deps.domain.media.write(sha, bytes);
    }
  }
  await deps.snapshot.applySnapshot(manifest);
}

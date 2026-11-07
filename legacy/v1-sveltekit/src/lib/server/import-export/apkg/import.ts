import type { ImportExportDeps } from '#lib/server/import-export/deps.js';
import { openAnkiDatabase, openApkg } from '#lib/server/import-export/apkg/open.js';
import { convertApkgToManifest } from '#lib/server/import-export/apkg/convert.js';
import { countsOf, applyPendingNative } from '#lib/server/import-export/native.js';
import { stashPending } from '#lib/server/import-export/pending-imports.js';
import type { DryRunReport } from '#lib/server/import-export/types.js';

export async function planApkgImport(
  deps: ImportExportDeps,
  bytes: Uint8Array,
): Promise<DryRunReport | { error: string }> {
  let bundle;
  try {
    bundle = await openApkg(bytes);
  } catch {
    return { error: 'bad_apkg' };
  }
  const warnings: string[] = [];
  let manifest;
  let mediaFiles;
  try {
    const db = openAnkiDatabase(bundle.collection);
    try {
      const converted = convertApkgToManifest(db, bundle, warnings, deps.now());
      manifest = converted.manifest;
      mediaFiles = converted.mediaFiles;
    } finally {
      db.close();
    }
  } catch {
    return { error: 'bad_apkg_collection' };
  }
  const token = stashPending({ format: 'apkg', manifest, mediaFiles, warnings }, deps.now());
  return {
    format: 'apkg',
    summary: 'Anki .apkg package.',
    warnings,
    conflicts: [],
    wouldImport: countsOf(manifest),
    importToken: token,
  };
}

export async function applyPendingApkg(
  deps: ImportExportDeps,
  manifest: Parameters<typeof applyPendingNative>[1],
  mediaFiles: Parameters<typeof applyPendingNative>[2],
): Promise<void> {
  await applyPendingNative(deps, manifest, mediaFiles);
}

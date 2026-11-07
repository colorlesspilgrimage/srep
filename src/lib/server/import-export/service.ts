import type { ImportExportDeps } from '#lib/server/import-export/deps.js';
import {
  planNativeImport,
  exportNativeArchive,
  applyPendingNative,
} from '#lib/server/import-export/native.js';
import { takePending } from '#lib/server/import-export/pending-imports.js';
import type { DryRunReport } from '#lib/server/import-export/types.js';
import { detectImportFormat } from '#lib/server/import-export/detect-format.js';
import { planApkgImport, applyPendingApkg } from '#lib/server/import-export/apkg/import.js';
import { planCsvImport, applyPendingCsv } from '#lib/server/import-export/csv-import.js';
import { exportApkg, exportCsv, exportText } from '#lib/server/import-export/export-formats.js';

export async function dryRunImport(
  deps: ImportExportDeps,
  bytes: Uint8Array,
  contentType: string,
): Promise<DryRunReport | { error: string }> {
  const format = detectImportFormat(bytes, contentType);
  if (format === 'native') {
    return planNativeImport(deps, bytes);
  }
  if (format === 'apkg') {
    return planApkgImport(deps, bytes);
  }
  if (format === 'csv' || format === 'tsv') {
    return planCsvImport(deps, bytes, format);
  }
  return { error: 'unknown_format' };
}

export async function applyImport(
  deps: ImportExportDeps,
  importToken: string,
): Promise<'ok' | 'bad_token' | 'conflicts'> {
  const pending = takePending(importToken, deps.now());
  if (pending === undefined) {
    return 'bad_token';
  }
  if (pending.format === 'native') {
    await applyPendingNative(deps, pending.manifest, pending.mediaFiles);
    return 'ok';
  }
  if (pending.format === 'apkg') {
    await applyPendingApkg(deps, pending.manifest, pending.mediaFiles);
    return 'ok';
  }
  if (pending.format === 'csv' || pending.format === 'tsv') {
    await applyPendingCsv(deps, pending.manifest);
    return 'ok';
  }
  return 'bad_token';
}

export async function exportArchive(
  deps: ImportExportDeps,
  format: string,
  deckId: string | undefined,
): Promise<Buffer | { error: string }> {
  if (format === 'native') {
    return exportNativeArchive(deps);
  }
  if (format === 'apkg') {
    return exportApkg(deps, deckId);
  }
  if (format === 'csv' || format === 'tsv') {
    return exportCsv(deps, format, deckId);
  }
  if (format === 'text') {
    return exportText(deps, deckId);
  }
  return { error: 'bad_format' };
}

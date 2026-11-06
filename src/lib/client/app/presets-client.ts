// Contract: the presets JSON client.
// A preset id enters a path only after the UUID check, then encodeURIComponent.
// Bodies leave only after acceptPreset. A failed check does not call fetch.

import { apiFetch, rejectedResult, type ApiResult } from '#lib/client/api.js';
import { encodedUuid } from './deck-id.js';
import { acceptPreset, type PresetDraft, type PresetInput, type PresetRow } from './preset-form.js';

type FetchJson = <T>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<ApiResult<T>>;

function presetPath(id: string): string | null {
  const encoded = encodedUuid(id);
  if (encoded === null) {
    return null;
  }
  return `/api/presets/${encoded}`;
}

export function createPresetsClient(fetchJson: FetchJson = apiFetch) {
  return {
    listPresets() {
      return fetchJson<{ presets: PresetRow[] }>('/api/presets');
    },
    createPreset(draft: PresetDraft) {
      const accepted = acceptPreset(draft);
      if (!accepted.ok) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson<{ preset: PresetRow }>('/api/presets', {
        method: 'POST',
        body: accepted.preset,
      });
    },
    updatePreset(id: string, draft: PresetDraft) {
      const path = presetPath(id);
      if (path === null) {
        return Promise.resolve(rejectedResult());
      }
      const accepted = acceptPreset(draft);
      if (!accepted.ok) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson<{ preset: PresetRow }>(path, {
        method: 'PUT',
        body: accepted.preset,
      });
    },
    deletePreset(id: string) {
      const path = presetPath(id);
      if (path === null) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson<{ ok: true }>(path, { method: 'DELETE' });
    },
  };
}

export type PresetsClient = ReturnType<typeof createPresetsClient>;

export type { PresetInput, PresetRow };

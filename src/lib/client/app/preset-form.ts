// Contract: pure preset form values aligned with presetSchema. No I/O.
// A bad field does not become a request body (CWE-20). No Zod on the client.
// FSRS params stay opaque: null on create, preserved on edit (no text field).

export type PresetInput = {
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  learningSteps: number[];
  relearningSteps: number[];
  maxInterval: number;
  fsrsParams: number[] | null;
  burySiblings: boolean;
  newOrder: 'added' | 'random';
};

export type PresetRow = PresetInput & { id: string };

export type PresetDraft = {
  name: string;
  newPerDayText: string;
  reviewsPerDayText: string;
  desiredRetentionText: string;
  learningStepsText: string;
  relearningStepsText: string;
  maxIntervalText: string;
  burySiblings: boolean;
  newOrder: 'added' | 'random';
  fsrsParams: number[] | null;
};

export const BLANK_PRESET_DRAFT: PresetDraft = {
  name: '',
  newPerDayText: '20',
  reviewsPerDayText: '200',
  desiredRetentionText: '0.9',
  learningStepsText: '1, 10',
  relearningStepsText: '10',
  maxIntervalText: '36500',
  burySiblings: false,
  newOrder: 'added',
  fsrsParams: null,
};

const MSGS = new Map<string, string>([
  ['builtin_protected', 'The default preset cannot be deleted.'],
  ['in_use', 'That preset is in use by a deck.'],
  ['name_taken', 'That preset name is already used.'],
]);

export function presetMessageFor(code: string): string {
  return MSGS.get(code) ?? 'The request failed.';
}

function intText(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,5}$/.test(raw)) {
    return null;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function stepsText(raw: string): number[] | null {
  const t = raw.trim();
  if (t === '') {
    return [];
  }
  const parts = t.split(',');
  if (parts.length > 10) {
    return null;
  }
  const out: number[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!/^\d{1,5}$/.test(s)) {
      return null;
    }
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0 || n > 43_200) {
      return null;
    }
    out.push(n);
  }
  return out;
}

export function draftFromPreset(p: PresetInput): PresetDraft {
  return {
    name: p.name,
    newPerDayText: String(p.newPerDay),
    reviewsPerDayText: String(p.reviewsPerDay),
    desiredRetentionText: String(p.desiredRetention),
    learningStepsText: p.learningSteps.join(', '),
    relearningStepsText: p.relearningSteps.join(', '),
    maxIntervalText: String(p.maxInterval),
    burySiblings: p.burySiblings,
    newOrder: p.newOrder,
    fsrsParams: p.fsrsParams,
  };
}

export function copyDraft(d: PresetDraft): PresetDraft {
  return { ...d, fsrsParams: d.fsrsParams === null ? null : [...d.fsrsParams] };
}

export function acceptPreset(
  d: PresetDraft,
): { ok: true; preset: PresetInput } | { ok: false; error: string } {
  const name = d.name.trim();
  if (name.length < 1 || name.length > 100 || name.includes('\u0000')) {
    return { ok: false, error: 'Enter a preset name (1 to 100 characters).' };
  }
  const newPerDay = intText(d.newPerDayText.trim(), 0, 9999);
  if (newPerDay === null) {
    return { ok: false, error: 'New per day must be 0 to 9999.' };
  }
  const reviewsPerDay = intText(d.reviewsPerDayText.trim(), 0, 9999);
  if (reviewsPerDay === null) {
    return { ok: false, error: 'Reviews per day must be 0 to 9999.' };
  }
  const retRaw = d.desiredRetentionText.trim();
  const desiredRetention = /^\d+(\.\d+)?$/.test(retRaw) ? Number(retRaw) : NaN;
  if (!Number.isFinite(desiredRetention) || desiredRetention < 0.7 || desiredRetention > 0.99) {
    return { ok: false, error: 'Desired retention must be 0.7 to 0.99.' };
  }
  const learningSteps = stepsText(d.learningStepsText);
  if (learningSteps === null) {
    return { ok: false, error: 'Learning steps must be up to 10 positive minutes.' };
  }
  const relearningSteps = stepsText(d.relearningStepsText);
  if (relearningSteps === null) {
    return { ok: false, error: 'Relearning steps must be up to 10 positive minutes.' };
  }
  const maxInterval = intText(d.maxIntervalText.trim(), 1, 36_500);
  if (maxInterval === null) {
    return { ok: false, error: 'Max interval must be 1 to 36500.' };
  }
  if (d.newOrder !== 'added' && d.newOrder !== 'random') {
    return { ok: false, error: 'New order must be added or random.' };
  }
  const fsrs = d.fsrsParams;
  if (
    fsrs !== null &&
    (!Array.isArray(fsrs) || fsrs.length < 19 || fsrs.length > 21 || !fsrs.every(Number.isFinite))
  ) {
    return { ok: false, error: 'FSRS params must be empty or 19 to 21 numbers.' };
  }
  return {
    ok: true,
    preset: {
      name,
      newPerDay,
      reviewsPerDay,
      desiredRetention,
      learningSteps,
      relearningSteps,
      maxInterval,
      fsrsParams: fsrs,
      burySiblings: d.burySiblings === true,
      newOrder: d.newOrder,
    },
  };
}

function isPreset(v: unknown): v is PresetRow {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.newPerDay === 'number' &&
    typeof o.reviewsPerDay === 'number' &&
    typeof o.desiredRetention === 'number' &&
    Array.isArray(o.learningSteps) &&
    Array.isArray(o.relearningSteps) &&
    typeof o.maxInterval === 'number' &&
    (o.fsrsParams === null || Array.isArray(o.fsrsParams)) &&
    typeof o.burySiblings === 'boolean' &&
    (o.newOrder === 'added' || o.newOrder === 'random')
  );
}

export function parsePresetsBody(body: unknown): PresetRow[] | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('presets' in body) ||
    !Array.isArray(body.presets)
  ) {
    return null;
  }
  const out: PresetRow[] = [];
  for (const item of body.presets) {
    if (!isPreset(item)) {
      return null;
    }
    out.push(item);
  }
  return out;
}

export function parsePresetBody(body: unknown): PresetRow | null {
  if (typeof body !== 'object' || body === null || !('preset' in body) || !isPreset(body.preset)) {
    return null;
  }
  return body.preset;
}

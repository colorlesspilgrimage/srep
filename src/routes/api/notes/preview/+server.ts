import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { MAX_FIELD_TEXT } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { previewNote } from '#lib/server/domain/note-preview.js';

// Contract: POST /api/notes/preview renders cards and does not write.
// The body is a strict object: noteTypeId UUID and fields.
// A guest is rejected by the auth hook before this handler runs.

const noNul = (value: string): boolean => !value.includes('\u0000');

const notePreviewSchema = z
  .object({
    noteTypeId: z.uuid(),
    fields: z.array(z.string().max(MAX_FIELD_TEXT).refine(noNul)).max(100),
  })
  .strict();

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, notePreviewSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await previewNote(getDomainContext(), body.data);
  return result.ok ? json({ cards: result.cards }) : errorResponse(result);
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { noteTypeCreateSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { createNoteType, listNoteTypes } from '#lib/server/domain/note-types.js';

export const GET: RequestHandler = async () => {
  const result = await listNoteTypes(getDomainContext());
  return result.ok ? json({ noteTypes: result.noteTypes }) : errorResponse(result);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, noteTypeCreateSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await createNoteType(getDomainContext(), body.data);
  return result.ok ? json({ noteType: result.noteType }, { status: 201 }) : errorResponse(result);
};

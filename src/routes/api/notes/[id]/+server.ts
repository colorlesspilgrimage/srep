import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { badRequest, errorResponse, readJson } from '#lib/server/auth/http.js';
import { idSchema, notePatchSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { getNote, trashNote, updateNote } from '#lib/server/domain/notes.js';

export const GET: RequestHandler = async ({ params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const result = await getNote(getDomainContext(), id.data);
  return result.ok ? json({ note: result.note }) : errorResponse(result);
};

export const PATCH: RequestHandler = async ({ request, params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const body = await readJson(request, notePatchSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await updateNote(getDomainContext(), id.data, body.data);
  return result.ok ? json({ note: result.note }) : errorResponse(result);
};

// Puts the note in the trash. The trash keeps it for 30 days.
export const DELETE: RequestHandler = async ({ params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const result = await trashNote(getDomainContext(), id.data);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};

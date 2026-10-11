import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { badRequest, errorResponse } from '#lib/server/auth/http.js';
import { idSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { deleteNoteType, getNoteType } from '#lib/server/domain/note-types.js';

export const GET: RequestHandler = async ({ params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const result = await getNoteType(getDomainContext(), id.data);
  return result.ok ? json({ noteType: result.noteType }) : errorResponse(result);
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const result = await deleteNoteType(getDomainContext(), id.data);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};

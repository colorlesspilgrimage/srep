import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { noteCreateSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { createNote } from '#lib/server/domain/notes.js';

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, noteCreateSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await createNote(getDomainContext(), body.data);
  return result.ok ? json({ note: result.note }, { status: 201 }) : errorResponse(result);
};

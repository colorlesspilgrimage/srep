import { json, type RequestHandler } from '@sveltejs/kit';
import type { z } from 'zod';
import type { Failure, Result } from '#lib/server/auth/deps.js';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { withPrivateHeaders } from '#lib/server/http/private-page.js';

type SettingsRouteOpts<TSchema extends z.ZodType, TGet extends object, TPut extends object> = {
  schema: TSchema;
  getSettings: () => Promise<Result<TGet>>;
  putSettings: (data: z.infer<TSchema>) => Promise<Result<TPut>>;
  getBody: (result: TGet) => Record<string, unknown>;
  putBody: (result: TPut) => Record<string, unknown>;
};

export function createSettingsRouteHandlers<
  TSchema extends z.ZodType,
  TGet extends object,
  TPut extends object,
>(opts: SettingsRouteOpts<TSchema, TGet, TPut>): { GET: RequestHandler; PUT: RequestHandler } {
  const respond = (result: Result<TGet | TPut>, body: Record<string, unknown>) => {
    const response = result.ok ? json(body) : errorResponse(result as Failure);
    return withPrivateHeaders(response);
  };

  return {
    GET: async () => {
      const result = await opts.getSettings();
      return respond(result, result.ok ? opts.getBody(result) : {});
    },
    PUT: async ({ request }) => {
      const body = await readJson(request, opts.schema);
      if (!body.ok) {
        return withPrivateHeaders(body.response);
      }
      const result = await opts.putSettings(body.data);
      return respond(result, result.ok ? opts.putBody(result) : {});
    },
  };
}

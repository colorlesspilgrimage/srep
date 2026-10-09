import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { checkHealth } from '#lib/server/health.js';
import { getLogger } from '#lib/server/logger.js';

export const prerender = false;

export const GET = async () => {
  const result = await checkHealth(() => getDb().ping(), getLogger());
  return json(result.body, {
    status: result.status,
    headers: {
      'cache-control': 'no-store',
    },
  });
};

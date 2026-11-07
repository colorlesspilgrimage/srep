import { getConfig } from '#lib/server/config.js';
import { createDb } from '#lib/server/db/client.js';
import { once } from '#lib/server/once.js';

export const getDb = once(() => createDb(getConfig()));

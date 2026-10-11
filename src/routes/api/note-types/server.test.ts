import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import type { NoteTypeWithTemplates } from '#lib/server/domain/store/store-types.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';
import {
  SESSION as session,
  UNKNOWN_ID,
  useDomainRouteContext,
} from '#lib/server/domain/test-support/route-support.js';
import { GET as list, POST as create } from './+server';
import { DELETE as remove, GET as get } from './[id]/+server';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const body = {
  name: 'Vocab',
  fields: ['Word', 'Audio'],
  templates: [{ name: 'Card', front: '{{Word}}{{#Audio}} {{Audio}}{{/Audio}}', back: '{{Word}}' }],
};
const at = (id: string, method: string) =>
  makeEvent(`/api/note-types/${id}`, { method, params: { id }, session }).event;
const post = (value: unknown) =>
  create(makeEvent('/api/note-types', { body: value, session }).event);

describe('note type routes', () => {
  it('lists the built-in types and creates, reads and deletes a custom type', async () => {
    h = await useDomainRouteContext();
    const listed = await readBody<{ noteTypes: NoteTypeWithTemplates[] }>(
      await list(makeEvent('/api/note-types', { method: 'GET', session }).event),
    );
    expect(listed.noteTypes.map((t) => t.name)).toEqual(['Basic', 'Basic+Reversed', 'Cloze']);
    const created = await post(body);
    expect(created.status).toBe(201);
    const { noteType } = await readBody<{ noteType: NoteTypeWithTemplates }>(created);
    expect(await readBody(await get(at(noteType.id, 'GET')))).toEqual({ noteType });
    expect(await readBody(await remove(at(noteType.id, 'DELETE')))).toEqual({ ok: true });
    expect((await get(at(noteType.id, 'GET'))).status).toBe(404);
  });

  it('answers the error codes', async () => {
    h = await useDomainRouteContext();
    const unknown = await post({
      ...body,
      templates: [{ name: 'C', front: '{{Nope}}', back: '' }],
    });
    expect(await readBody(unknown)).toEqual({ error: 'unknown_field' });
    const broken = await post({
      ...body,
      templates: [{ name: 'C', front: '{{#Word}}', back: '' }],
    });
    expect(broken.status).toBe(400);
    expect(await readBody(broken)).toEqual({ error: 'invalid_template' });
    expect((await post({ ...body, extra: true })).status).toBe(400);
    expect((await remove(at(BASIC_ID, 'DELETE'))).status).toBe(409);
    expect((await get(at('x', 'GET'))).status).toBe(400);
    expect((await remove(at('x', 'DELETE'))).status).toBe(400);
    expect((await remove(at(UNKNOWN_ID, 'DELETE'))).status).toBe(404);
  });
});

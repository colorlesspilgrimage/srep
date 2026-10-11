import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  pathOf,
  planDeckCreate,
  planDeckUpdate,
  subtreeIds,
  validateDeckName,
  type DeckPatch,
} from '#lib/server/domain/core/deck-paths.js';
import type { DeckRow } from '#lib/server/domain/store/store-types.js';

function deck(id: string, name: string, parent: DeckRow | null = null): DeckRow {
  return {
    id,
    parentId: parent?.id ?? null,
    name,
    path: pathOf(parent, name),
    presetId: 'p',
    description: '',
    archivedAt: null,
  };
}

// Applies a successful plan to the deck list, like the store does.
function apply(decks: DeckRow[], id: string, patch: DeckPatch) {
  const change = planDeckUpdate(decks, id, patch);
  if (!change.ok) {
    return { change, decks };
  }
  const byId = new Map(change.updates.map((d) => [d.id, d]));
  return { change, decks: decks.map((d) => byId.get(d.id) ?? d) };
}

function tree() {
  const a = deck('a', 'A');
  const b = deck('b', 'B', a);
  const c = deck('c', 'C', b);
  const x = deck('x', 'X');
  return [a, b, c, x];
}

const paths = (decks: DeckRow[]) => Object.fromEntries(decks.map((d) => [d.id, d.path]));

describe('validateDeckName', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['x', 'x'],
    ['  padded  ', 'padded'],
    ['x'.repeat(100), 'x'.repeat(100)],
    ['x'.repeat(101), null],
    ['a::b', null],
    ['a:b', 'a:b'],
    ['a\u0000b', null],
    ['a\u0007b', null],
    ['50% _off_ \\o/', '50% _off_ \\o/'],
  ])('%j gives %j', (name, expected) => {
    expect(validateDeckName(name)).toBe(expected);
  });
});

describe('planDeckUpdate', () => {
  it('renames a leaf', () => {
    const { decks } = apply(tree(), 'c', { name: 'C2' });
    expect(paths(decks)).toMatchObject({ c: 'A::B::C2' });
  });

  it('renames a parent and rewrites the descendants', () => {
    const { change, decks } = apply(tree(), 'a', { name: 'Lang' });
    expect(paths(decks)).toEqual({ a: 'Lang', b: 'Lang::B', c: 'Lang::B::C', x: 'X' });
    expect(change.ok && change.updates.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves a deck to the root and under another deck', () => {
    const root = apply(tree(), 'b', { parentId: null }).decks;
    expect(paths(root)).toMatchObject({ b: 'B', c: 'B::C' });
    expect(root.find((d) => d.id === 'b')?.parentId).toBeNull();
    const under = apply(tree(), 'b', { parentId: 'x' }).decks;
    expect(paths(under)).toMatchObject({ b: 'X::B', c: 'X::B::C' });
  });

  it('refuses a move into itself or a descendant', () => {
    expect(planDeckUpdate(tree(), 'a', { parentId: 'a' })).toMatchObject({ error: 'deck_cycle' });
    expect(planDeckUpdate(tree(), 'a', { parentId: 'c' })).toMatchObject({
      status: 409,
      error: 'deck_cycle',
    });
  });

  it('refuses a name clash and accepts a no-op patch', () => {
    const decks = [...tree(), deck('b2', 'B2', tree()[0] ?? null)];
    expect(planDeckUpdate(decks, 'b2', { name: 'B' })).toMatchObject({
      status: 409,
      error: 'deck_name_taken',
    });
    expect(planDeckUpdate(decks, 'b', { name: 'B' })).toEqual({ ok: true, updates: [] });
  });

  it('gives not_found for an unknown deck or parent, and bad_request for a bad name', () => {
    expect(planDeckUpdate(tree(), 'zz', {})).toMatchObject({ status: 404 });
    expect(planDeckUpdate(tree(), 'a', { parentId: 'zz' })).toMatchObject({ status: 404 });
    expect(planDeckUpdate(tree(), 'a', { name: 'a::b' })).toMatchObject({ status: 400 });
  });

  it('changes preset and description of the target only', () => {
    const { change } = apply(tree(), 'b', { presetId: 'q', description: 'd' });
    expect(change).toEqual({
      ok: true,
      updates: [{ ...deck('b', 'B', deck('a', 'A')), presetId: 'q', description: 'd' }],
    });
  });

  it('refuses depth 21', () => {
    const chain: DeckRow[] = [];
    for (let i = 0; i < 20; i += 1) {
      chain.push(deck(`d${i}`, `n${i}`, chain[i - 1] ?? null));
    }
    const leaf = deck('leaf', 'leaf');
    expect(planDeckCreate(chain, 'more', 'd19')).toMatchObject({ status: 400 });
    expect(planDeckCreate(chain, 'ok', 'd18')).toMatchObject({ ok: true });
    expect(planDeckUpdate([...chain, leaf], 'leaf', { parentId: 'd19' })).toMatchObject({
      status: 400,
    });
  });

  it('does not mix decks whose names hold %, _ or \\', () => {
    const a = deck('a', 'A%');
    const ab = deck('ab', 'AB');
    const child = deck('c', '_', a);
    const slash = deck('s', 'A\\');
    expect(subtreeIds([a, ab, child, slash], 'a')).toEqual(['a', 'c']);
    const { decks } = apply([a, ab, child, slash], 'a', { name: 'Z' });
    expect(paths(decks)).toEqual({ a: 'Z', ab: 'AB', c: 'Z::_', s: 'A\\' });
  });

  it('does not count A::B2 as part of A::B', () => {
    const a = deck('a', 'A');
    const b = deck('b', 'B', a);
    const b2 = deck('b2', 'B2', a);
    expect(subtreeIds([a, b, b2], 'b')).toEqual(['b']);
  });
});

describe('planDeckCreate', () => {
  it('finds the parent and path, and refuses clashes and unknown parents', () => {
    expect(planDeckCreate(tree(), 'D', 'b')).toMatchObject({ ok: true, path: 'A::B::D' });
    expect(planDeckCreate(tree(), 'B', 'a')).toMatchObject({ error: 'deck_name_taken' });
    expect(planDeckCreate(tree(), 'D', 'zz')).toMatchObject({ error: 'not_found' });
  });
});

// The parent chain is the source of truth. Paths must agree with it.
function checkInvariants(decks: DeckRow[]): void {
  const byId = new Map(decks.map((d) => [d.id, d]));
  for (const d of decks) {
    const parent = d.parentId === null ? null : byId.get(d.parentId);
    expect(parent).toBeDefined();
    expect(d.path).toBe(pathOf(parent ?? null, d.name));
  }
  expect(new Set(decks.map((d) => d.path)).size).toBe(decks.length);
}

const descendants = (decks: DeckRow[], id: string) => new Set(subtreeIds(decks, id).slice(1));

function buildForest(ops: { parent: number; name: string }[]): DeckRow[] {
  const decks: DeckRow[] = [];
  ops.forEach((op, i) => {
    const parentId = op.parent < 0 ? null : (decks[op.parent % (decks.length || 1)]?.id ?? null);
    const created = planDeckCreate(decks, op.name, parentId);
    if (created.ok) {
      decks.push({ ...deck(`d${i}`, op.name, created.parent), path: created.path });
    }
  });
  return decks;
}

function checkMove(before: DeckRow[], after: DeckRow[], movedId: string): void {
  const moved = new Set(subtreeIds(before, movedId));
  for (const d of before) {
    const was = descendants(before, d.id);
    const now = descendants(after, d.id);
    if (moved.has(d.id)) {
      expect(now).toEqual(was);
    } else {
      expect([...now].filter((id) => !moved.has(id)).sort()).toEqual(
        [...was].filter((id) => !moved.has(id)).sort(),
      );
    }
  }
}

describe('deck path properties (seeded)', () => {
  const name = fc.constantFrom('a', 'b', 'A%', '_', '\\', '😀');
  const create = fc.record({ parent: fc.integer({ min: -1, max: 20 }), name });
  const move = fc.record({
    deck: fc.nat(),
    parent: fc.integer({ min: -1, max: 30 }),
    name: fc.option(name),
  });

  it('keeps paths valid and unique after renames and moves, and moves back exactly', () => {
    fc.assert(
      fc.property(
        fc.array(create, { minLength: 1, maxLength: 15 }),
        fc.array(move, { maxLength: 8 }),
        (creates, moves) => {
          let decks = buildForest(creates);
          checkInvariants(decks);
          for (const m of moves) {
            const target = decks[m.deck % decks.length] as DeckRow;
            const parentId = m.parent < 0 ? null : (decks[m.parent % decks.length]?.id ?? null);
            const patch = { parentId, ...(m.name === null ? {} : { name: m.name }) };
            const result = apply(decks, target.id, patch);
            checkInvariants(result.decks);
            if (!result.change.ok) {
              continue;
            }
            checkMove(decks, result.decks, target.id);
            const back = apply(result.decks, target.id, {
              parentId: target.parentId,
              name: target.name,
            });
            expect(back.change.ok).toBe(true);
            expect(paths(back.decks)).toEqual(paths(decks));
            decks = result.decks;
          }
        },
      ),
      { seed: 20261011, numRuns: 200 },
    );
  });

  it('always refuses a move into a descendant', () => {
    fc.assert(
      fc.property(fc.array(create, { minLength: 2, maxLength: 15 }), (creates) => {
        const decks = buildForest(creates);
        for (const d of decks) {
          for (const inner of subtreeIds(decks, d.id)) {
            expect(planDeckUpdate(decks, d.id, { parentId: inner })).toMatchObject({
              error: 'deck_cycle',
            });
          }
        }
      }),
      { seed: 20261011, numRuns: 200 },
    );
  });
});

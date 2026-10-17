// Contract: parseBrowseQuery turns a browse string into filters.
// Input: a string of at most 500 characters and at most 8 tokens.
// Output: { ok: true, query } or { ok: false, error: 'bad_query' }.
// A `"` pair groups text. An odd quote count is bad_query.
// A quoted token is free text, even when it looks like deck: or is:.
// An unquoted deck:, tag:, is:, or prop: token is that filter.
// The query string stays data. This module does not build SQL.

import { normalizeTags } from '#lib/server/domain/core/tags.js';
import type { BrowseIs, BrowseOp, BrowseQuery, ParsedBrowse } from '#lib/server/browse/types.js';

const MAX_QUERY_CHARS = 500;
const MAX_TOKENS = 8;
const MAX_PROP = 1_000_000;
const PROP = /^(lapses)(>=|<=|>|<|=)(0|[1-9][0-9]*)$/;

type Token = { text: string; forceFree: boolean };

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v';
}

function charAt(input: string, index: number): string {
  return input[index] ?? '';
}

function countQuotes(input: string): number {
  let count = 0;
  for (const ch of input) {
    if (ch === '"') count += 1;
  }
  return count;
}

function readToken(input: string, start: number): { token: Token; next: number } | null {
  const forceFree = charAt(input, start) === '"';
  let text = '';
  let inQuote = false;
  let index = start;
  while (index < input.length) {
    const ch = charAt(input, index);
    if (ch === '"') {
      inQuote = !inQuote;
      index += 1;
      continue;
    }
    if (!inQuote && isSpace(ch)) break;
    text += ch;
    index += 1;
  }
  if (text.length === 0) return null;
  return { token: { text, forceFree }, next: index };
}

function tokenize(input: string): Token[] | null {
  if (countQuotes(input) % 2 !== 0) return null;
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    while (index < input.length && isSpace(charAt(input, index))) index += 1;
    if (index >= input.length) break;
    const read = readToken(input, index);
    if (read === null) return null;
    tokens.push(read.token);
    index = read.next;
  }
  return tokens;
}

function emptyQuery(): BrowseQuery {
  return { decks: [], tags: [], is: [], props: [], texts: [] };
}

function cutPrefix(text: string, prefix: string): string | null {
  return text.startsWith(prefix) ? text.slice(prefix.length) : null;
}

function pushText(query: BrowseQuery, text: string): boolean {
  if (text.length < 1) return false;
  query.texts.push(text);
  return true;
}

function pushDeck(query: BrowseQuery, path: string): boolean {
  if (path.length < 1) return false;
  query.decks.push(path);
  return true;
}

function pushTag(query: BrowseQuery, raw: string): boolean {
  const tags = normalizeTags([raw]);
  const tag = tags?.[0];
  if (tags === null || tags.length !== 1 || tag === undefined) return false;
  query.tags.push(tag);
  return true;
}

function pushIs(query: BrowseQuery, value: string): boolean {
  if (value !== 'due' && value !== 'new' && value !== 'suspended') return false;
  query.is.push(value as BrowseIs);
  return true;
}

function asOp(raw: string): BrowseOp | null {
  if (raw === '>' || raw === '>=' || raw === '<' || raw === '<=' || raw === '=') return raw;
  return null;
}

function pushProp(query: BrowseQuery, value: string): boolean {
  const match = PROP.exec(value);
  const op = asOp(match?.[2] ?? '');
  const digits = match?.[3];
  if (match === null || op === null || digits === undefined) return false;
  const number = Number(digits);
  if (!Number.isSafeInteger(number) || number > MAX_PROP) return false;
  query.props.push({ op, value: number });
  return true;
}

function classify(token: Token, query: BrowseQuery): boolean {
  if (token.forceFree) return pushText(query, token.text);
  const deck = cutPrefix(token.text, 'deck:');
  if (deck !== null) return pushDeck(query, deck);
  const tag = cutPrefix(token.text, 'tag:');
  if (tag !== null) return pushTag(query, tag);
  const isValue = cutPrefix(token.text, 'is:');
  if (isValue !== null) return pushIs(query, isValue);
  const prop = cutPrefix(token.text, 'prop:');
  if (prop !== null) return pushProp(query, prop);
  return pushText(query, token.text);
}

export function parseBrowseQuery(input: string): ParsedBrowse {
  if (input.length > MAX_QUERY_CHARS || input.includes('\u0000')) {
    return { ok: false, error: 'bad_query' };
  }
  const tokens = tokenize(input);
  if (tokens === null || tokens.length > MAX_TOKENS) {
    return { ok: false, error: 'bad_query' };
  }
  const query = emptyQuery();
  for (const token of tokens) {
    if (!classify(token, query)) return { ok: false, error: 'bad_query' };
  }
  return { ok: true, query };
}

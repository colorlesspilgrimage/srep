// Contract: types for a parsed browse query and one result row.
// No I/O. No SQL.

export type BrowseIs = 'due' | 'new' | 'suspended';

export type BrowseOp = '>' | '>=' | '<' | '<=' | '=';

export type BrowseProp = { op: BrowseOp; value: number };

// Every list is AND. `is:due` uses the study-day end. It is not a state name.
export type BrowseQuery = {
  decks: string[];
  tags: string[];
  is: BrowseIs[];
  props: BrowseProp[];
  texts: string[];
};

export type ParsedBrowse = { ok: true; query: BrowseQuery } | { ok: false; error: 'bad_query' };

// frontText is plain text. The list does not render a card template.
export type BrowseRow = {
  cardId: string;
  noteId: string;
  deckId: string;
  deckPath: string;
  state: string;
  due: number;
  lapses: number;
  frontText: string;
  tags: string[];
};

export type BrowsePage = {
  rows: BrowseRow[];
  nextCursor: string | null;
};

// One joined card row before tags and frontText are filled in.
export type BrowseRawRow = {
  cardId: string;
  noteId: string;
  deckId: string | null;
  deckPath: string;
  state: string;
  due: number;
  lapses: number;
  fields: readonly string[];
};

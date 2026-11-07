export type BrowseIs = 'due' | 'new' | 'suspended';

export type BrowseOp = '>' | '>=' | '<' | '<=' | '=';

export type BrowseProp = { op: BrowseOp; value: number };

export type BrowseQuery = {
  decks: string[];
  tags: string[];
  is: BrowseIs[];
  props: BrowseProp[];
  texts: string[];
};

export type ParsedBrowse = { ok: true; query: BrowseQuery } | { ok: false; error: 'bad_query' };

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

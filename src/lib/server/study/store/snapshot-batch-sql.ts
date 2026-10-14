// Contract: SQL for one batched study snapshot.
// Inputs are deck ids, the study window, and a shuffle expression.
// Each value is a bound parameter. The shuffle numbers are constants.
// Deleted notes stay out of card counts and heads.
// Done counts use the old review_log join. They keep trashed notes.
import { sql, type SQL } from 'drizzle-orm';
import { card, note, reviewLog } from '#lib/server/db/schema/sqlite.js';
import { SHUFFLE_MODULUS, SHUFFLE_MULTIPLIER } from '#lib/server/study/core/queue-choice.js';
import type { StudySnapshotInput } from '#lib/server/study/store/study-store-types.js';

export function idList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

export function sqliteShuffleKey(): SQL {
  const factor = sql.raw(String(SHUFFLE_MULTIPLIER));
  const modulus = sql.raw(String(SHUFFLE_MODULUS));
  return sql`(cast(${card.position} as integer) * ${factor}) % ${modulus}`;
}

export function pgShuffleKey(): SQL {
  const factor = sql.raw(String(SHUFFLE_MULTIPLIER));
  const modulus = sql.raw(String(SHUFFLE_MODULUS));
  return sql`(cast(${card.position} as bigint) * ${factor}) % ${modulus}`;
}

export function doneSql(ids: SQL, input: StudySnapshotInput): SQL {
  const { startMs, endMs } = input.window;
  return sql`select ${card.deckId} as deck_id, ${reviewLog.stateBefore} as state_before, count(*) as n
    from ${reviewLog}
    inner join ${card} on ${card.id} = ${reviewLog.cardId}
    where ${card.deckId} in (${ids})
      and ${reviewLog.reviewedAt} >= ${startMs}
      and ${reviewLog.reviewedAt} < ${endMs}
      and ${reviewLog.stateBefore} in ('new', 'review')
    group by ${card.deckId}, ${reviewLog.stateBefore}`;
}

export function learningSql(ids: SQL, input: StudySnapshotInput): SQL {
  const { nowMs } = input;
  const { endMs } = input.window;
  return sql`select ${card.deckId} as deck_id,
      coalesce(sum(case when ${card.due} <= ${nowMs} then 1 else 0 end), 0) as due_now,
      coalesce(sum(case when ${card.due} < ${endMs} then 1 else 0 end), 0) as today,
      min(case when ${card.due} > ${nowMs} and ${card.due} < ${endMs} then ${card.due} end) as next_due
    from ${card}
    inner join ${note} on ${note.id} = ${card.noteId}
    where ${card.deckId} in (${ids}) and ${note.deletedAt} is null
      and ${card.state} in ('learning', 'relearning')
    group by ${card.deckId}`;
}

function live(ids: SQL, filter: SQL): SQL {
  return sql`${card.deckId} in (${ids}) and ${note.deletedAt} is null and ${filter}`;
}

export function countSql(ids: SQL, filter: SQL): SQL {
  return sql`select ${card.deckId} as deck_id, count(*) as n
    from ${card}
    inner join ${note} on ${note.id} = ${card.noteId}
    where ${live(ids, filter)}
    group by ${card.deckId}`;
}

export function headSql(ids: SQL, filter: SQL, order: SQL): SQL {
  return sql`select deck_id, card_id, due, position from (
      select ${card.deckId} as deck_id, ${card.id} as card_id, ${card.due} as due,
        ${card.position} as position,
        row_number() over (partition by ${card.deckId} order by ${order}) as rn
      from ${card}
      inner join ${note} on ${note.id} = ${card.noteId}
      where ${live(ids, filter)}
    ) ranked
    where rn = 1`;
}

export function learningFilter(nowMs: number): SQL {
  return sql`${card.state} in ('learning', 'relearning') and ${card.due} <= ${nowMs}`;
}

export function reviewFilter(endMs: number): SQL {
  return sql`${card.state} = 'review' and ${card.due} < ${endMs}`;
}

export function freshFilter(): SQL {
  return sql`${card.state} = 'new'`;
}

export function learningOrder(): SQL {
  return sql`${card.due} asc, ${card.id} asc`;
}

export function reviewOrder(): SQL {
  return sql`${card.due} asc, ${card.position} asc, ${card.id} asc`;
}

export function newOrder(shuffleIds: string[], shuffleKey: SQL): SQL {
  const gate = shuffleIds.length === 0 ? sql`0` : sql`${card.deckId} in (${idList(shuffleIds)})`;
  const first = sql`case when ${gate} then ${shuffleKey} else ${card.position} end`;
  return sql`${first} asc, ${card.position} asc, ${card.id} asc`;
}

-- Makes "@CebuWeekendPicklers" in a post resolvable back to the club it
-- names, so the feed can render it as a real link.
--
-- A generated column rather than a post_mentions join table, deliberately:
--   * No write path to keep in sync — nothing can post a mention row that
--     disagrees with the post's own text.
--   * Renaming a club re-points its existing mentions automatically,
--     because the handle is derived from the current name rather than
--     frozen at post time.
--   * Resolution is one batched `where mention_handle in (...)` per feed
--     render, and RLS still applies — a mention of a private club the
--     viewer can't see simply doesn't resolve, and stays plain text.
--
-- The expression must stay character-for-character equivalent to
-- clubMentionHandle() in src/lib/services/clubs.ts; a divergence would
-- silently stop mentions matching. Tests pin both sides.
alter table public.clubs
  add column mention_handle text
  generated always as (regexp_replace(name, '[^a-zA-Z0-9_]', '', 'g')) stored;

-- Not unique: two clubs can legitimately collapse to the same handle
-- ("Court 9" and "Court-9"). The resolver picks the largest club and the
-- rest stay plain text, which is better than rejecting a valid club name.
create index clubs_mention_handle_idx on public.clubs (mention_handle);

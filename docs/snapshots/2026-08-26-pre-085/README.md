# Production ranked state, captured 2026-08-26 before migration 085

Migration `20260810000085_unify_player_rating.sql` does
`drop table if exists public.player_ranks;` — it does not alter the table, it
destroys and rebuilds it. Every rating, tier, calibration count, win, loss and
streak goes with it, and each player currently has TWO rows (singles and
doubles) which become one.

The founder authorized that reset against an enumerated list. This snapshot
exists so the pre-reset state is recoverable as data if anyone ever needs to
answer "what did this player have before", which the migration itself makes
unanswerable.

## Contents

| file | rows | note |
|---|---|---|
| `player_ranks.json` | 9 | destroyed by 085 |
| `ranked_matches.json` | 5 | survives 085 |
| `ranked_match_players.json` | 16 | survives 085, but its `rating_before`/`rating_after` become orphaned — numbers on a scale no player is on any more |

Verified at capture: each file's row count was checked against an independent
`count(*)`, and every account carrying real history (non-zero wins, losses or
calibration progress) was confirmed present in `player_ranks.json`. A snapshot
that silently truncated would be worse than none.

## One row here is not what it originally was

`ranked_matches` entry `15aa51ca-75e9-4030-9387-8850520784dc` reads 11–5. That
is **not** its original score. A verification probe run during the migration-100
incident on 2026-08-26 overwrote the scores and re-applied the rating, and no
copy of the original exists. The ratings that probe moved were restored exactly
from `ranked_match_players.rating_before`; the scores could not be.

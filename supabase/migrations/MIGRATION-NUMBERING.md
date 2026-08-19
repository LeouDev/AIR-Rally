# Migration numbering — one number, one file

`scripts/apply-production-migrations.ts` selects files by their numeric
prefix (`f.split("_")[0]` compared against `--from` / `--to`). A prefix is
therefore an ADDRESS, and two files sharing one cannot be addressed
separately: `--from N` takes both, `--from N+1` takes neither.

That is not a tidiness rule. On 2026-08-18 three different files were
independently numbered `20260810000065` by three sessions working in
parallel:

- `20260810000065_device_push_tokens.sql`      (working tree — renumbered to …066)
- `20260810000065_paymongo_aware_expiry_sweep.sql`          (in `stash@{0}`)
- `20260810000065_owner_application_approved_notification.sql` (in `stash@{1}`)

Applying the intended one to production with `--from 20260810000065` would
also have applied the others — unreviewed schema changes riding out on an
approved deploy, with no flag able to separate them.

The two stashed files STILL SHARE `…065` with each other. Whoever restores
either one must renumber it first, and update the comment references in the
code that names it (grep the number across `src/`).

Before adding a migration: `ls supabase/migrations | tail -1`, and take the
next number. Check the stash list too — a number can be claimed by work that
is not in the tree yet.

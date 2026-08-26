/**
 * READ-ONLY drift check: does this database still match supabase/migrations?
 *
 * The gap this closes: this project has never used the Supabase CLI's
 * migration-history workflow (no supabase/config.toml; see
 * apply-staging-migrations.ts, which documents the Dashboard-SQL-Editor
 * process it replaced). Nothing records what was applied, so schema can
 * reach a database out-of-band and leave no trace. That happened: staging
 * carries a trigger from a stashed migration that exists in no commit, and
 * an apply_ranked_result variant whose dollar-quote tag ($fn$) appears
 * nowhere in this repo. Production was audited object-by-object and is
 * clean — but clean because someone looked, not because anything prevents
 * it. This makes "someone looked" repeatable and cheap.
 *
 * WHAT IT CHECKS
 *   A. Reverse audit      — every object in `public` is named by some
 *                           migration file. Catches schema that arrived
 *                           out-of-band.
 *   B. Body reconciliation — every function's live body matches the LAST
 *                           definition of it in the tree. Catches an
 *                           edited variant applied over a committed one,
 *                           which (A) cannot see because the name matches.
 *   C. Forward audit      — every object the tree creates (and does not
 *                           later drop) exists in the database. Catches a
 *                           migration that was never applied here, which is
 *                           exactly how staging came to be missing 058.
 *   F. Trigger target     — every trigger fires the function the tree says it
 *                           fires. A trigger repointed at a different function
 *                           keeps its name, so (A) and (C) both pass it, and it
 *                           is not a function body so (B) misses it too. This
 *                           compares a structural fact rather than an
 *                           expression, so unlike constraint or policy
 *                           predicates it can be compared against the tree
 *                           reliably — the catalog does not rewrite it.
 *   E. Identifier length  — no NEW policy name may exceed Postgres's 63-byte
 *                           identifier limit. Three existing names already do
 *                           and are allowlisted below: they are knowingly
 *                           accepted, because renaming a live policy to close
 *                           a latent issue is the wrong trade mid-release.
 *                           A rename fixes three names; this rule catches
 *                           every future one.
 *   D. Ledger check       — SEAM, not implemented. Moot until baselining
 *                           creates supabase_migrations.schema_migrations.
 *                           See the stub at the bottom.
 *
 * (A) alone would have caught the stashed-migration trigger the day it
 * landed. (B) would have caught the ranked variant. (C) would have caught
 * staging running without the notification email webhook. None needs CI.
 *
 * (A) and (C) are deliberately separate directions, not one comparison:
 * "the database has something the tree doesn't" and "the tree has something
 * the database doesn't" are different failures with different causes — one
 * is out-of-band SQL, the other is an unapplied migration.
 *
 * Comments are stripped before matching, so a name that appears only in a
 * comment does NOT count as accounted for. That is the difference between
 * this and a grep.
 *
 * SAFETY: every statement is a SELECT, inside a READ ONLY transaction that
 * is rolled back. Deliberately does NOT import assert-staging-env — same
 * precedent as audit-production-readonly.ts: that gate is for scripts that
 * write, and pointing this at production is a supported, intended use.
 *
 * EXIT CODE: 0 when clean, 1 on any drift, so it can gate a deploy or a CI
 * job unchanged.
 *
 * Usage (after sourcing an env file with DATABASE_URL):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/check-schema-drift.ts
 *
 *   --json   machine-readable output for CI
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/** Overridable so the check can run against a checkout other than this one. */
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(__dirname, "..", "supabase", "migrations");

/** Objects the platform owns; no app migration should be expected to declare them. */
const PLATFORM_PREFIXES = /^(pg_|supabase_|graphql|pgrst_|_realtime)/;

/**
 * Postgres truncates identifiers to NAMEDATALEN-1 = 63 BYTES. Three policy
 * names in this tree exceed that, so what the migration writes and what
 * pg_policies reports are different strings. Comparing untruncated names
 * reports those policies as missing from a database that has them.
 * (Worth fixing at the source too: two policy names differing only after
 * byte 63 would silently collide.)
 */
function truncateIdentifier(name: string): string {
  const bytes = Buffer.from(name, "utf8");
  if (bytes.length <= 63) return name;
  // Drop any partial multi-byte character left at the cut.
  return bytes.subarray(0, 63).toString("utf8").replace(/\uFFFD$/, "");
}

/**
 * Policy names already over 63 bytes when this rule was written. Postgres
 * truncates them silently, so the tree and pg_policies hold different
 * strings. Harmless while they stay unique in their first 63 bytes — two
 * names differing only after byte 63 would collide with no warning.
 * Deliberately an allowlist, not a threshold bump: these three are accepted,
 * a fourth is a bug.
 */
const KNOWN_OVERLONG_POLICY_NAMES: ReadonlySet<string> = new Set([
  "event attendees are publicly readable, pending requests are private",
  "users create their own events, court-backed by their own booking",
  "users can create posts as themselves, club posts require membership",
]);

type Finding = { check: "reverse-audit" | "forward-audit" | "body-reconciliation" | "identifier-length" | "trigger-target"; kind: string; name: string; detail: string };

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Comments stripped and whitespace collapsed: compares logic, not formatting. */
function normaliseBody(body: string): string {
  return stripSqlComments(body).replace(/\s+/g, " ").trim();
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Maps a PostgreSQL type spelling onto the form pg_get_function_identity_arguments
 * reports it in — the catalog's canonical name, not whatever alias a migration
 * happened to write. Covers every type spelling actually used in this repo's
 * function signatures as of when this was written; an unmapped type simply
 * passes through unchanged; PostgreSQL renaming a rarely-used spelling.
 */
const TYPE_ALIASES: Record<string, string> = {
  timestamptz: "timestamp with time zone",
  int: "integer",
  int4: "integer",
  bool: "boolean",
  varchar: "character varying",
  serial: "integer",
};

function normaliseTypeName(raw: string): string {
  const t = raw.trim().replace(/^public\./i, "");
  const arrayMatch = t.match(/^(.*?)\s*\[\s*\]$/);
  if (arrayMatch) return normaliseTypeName(arrayMatch[1]) + "[]";
  return TYPE_ALIASES[t.toLowerCase()] ?? t.toLowerCase();
}

/**
 * "p_scope public.court_side_scope default 'for_you', p_limit integer default 20"
 * -> "p_scope court_side_scope, p_limit integer" — strips DEFAULT clauses (identity
 * arguments never include them) and normalises each type, so this can be compared
 * directly against pg_get_function_identity_arguments()'s own output.
 */
function normaliseParamList(raw: string): string {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of raw) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const noDefault = p.split(/\bdefault\b/i)[0].trim();
      const m = noDefault.match(/^([a-z0-9_]+)\s+(.+)$/i);
      if (!m) return noDefault.toLowerCase();
      return `${m[1].toLowerCase()} ${normaliseTypeName(m[2])}`;
    })
    .join(", ");
}

/**
 * The last definition of each (name, signature) pair across the tree in
 * version order — `create or replace` only supersedes a function with the
 * SAME signature; a different parameter list is a different overload and
 * must be tracked separately. Getting this wrong was a real false positive
 * caught on this checker's first production overload (court_side_feed
 * during its expand/contract migration): keying by name alone made the
 * still-correct, still-alive 2-arg overload compare against the newer
 * 4-arg body and appear to "differ" when it hadn't changed at all.
 */
function expectedFunctionBodies(files: string[]): Map<string, { body: string; file: string }> {
  const defs = new Map<string, { body: string; file: string }>();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const name = m[1].toLowerCase();
      const afterParen = sql.slice(m.index + m[0].length);
      let depth = 1, i = 0;
      while (i < afterParen.length && depth > 0) {
        if (afterParen[i] === "(") depth++;
        if (afterParen[i] === ")") depth--;
        i++;
      }
      const paramList = afterParen.slice(0, i - 1);
      const signature = normaliseParamList(paramList);

      const after = sql.slice(m.index);
      const tagMatch = after.match(/\bas\s+\$([a-zA-Z_0-9]*)\$/);
      if (!tagMatch) continue;
      const tag = `$${tagMatch[1]}$`;
      const start = after.indexOf(tag, tagMatch.index!) + tag.length;
      const end = after.indexOf(tag, start);
      if (end < 0) continue;
      defs.set(`${name}(${signature})`, { body: after.slice(start, end), file });
    }
  }
  return defs;
}

/**
 * Objects the tree CREATES, minus any it later drops. Names only: a name is
 * either there or it isn't, and that is all this direction needs to know.
 */
function expectedObjects(files: string[]): { kind: string; name: string; file: string }[] {
  const created: { kind: string; name: string; file: string }[] = [];
  const dropped = new Set<string>();
  // Strip a schema qualifier and surrounding double quotes ONLY. Apostrophes
  // are part of real policy names ("Venue owners manage their own venue's
  // amenities") and stripping them silently breaks every match.
  const clean = (raw: string) =>
    raw.trim().replace(/;+$/, "").replace(/^"([\s\S]*)"$/, "$1")  // [\s\S] rather than the /s flag: tsconfig targets ES2017.replace(/^public\./i, "").trim().toLowerCase();
  const patterns: { kind: string; re: RegExp }[] = [
    { kind: "function", re: /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\(/gi },
    { kind: "table", re: /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi },
    { kind: "trigger", re: /create\s+(?:or\s+replace\s+)?trigger\s+([a-z0-9_."]+)/gi },
    { kind: "policy", re: /create\s+policy\s+("[^"]+"|[a-z0-9_]+)/gi },
  ];
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    for (const { kind, re } of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) created.push({ kind, name: clean(m[1]), file });
    }
    // Two patterns: policies are frequently quoted and contain spaces and
    // commas, so a bare identifier class cannot match them. A missed DROP
    // reads as "never applied", which is the worst kind of false positive.
    for (const dropRe of [
      /drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[a-z0-9_]+)/gi,
      /drop\s+(?:function|table|trigger|index)\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/gi,
    ]) {
      let d: RegExpExecArray | null;
      while ((d = dropRe.exec(sql))) dropped.add(clean(d[1]));
    }
  }
  // Deduplicate: `create or replace` across several files is one object.
  const seen = new Set<string>();
  return created.filter((o) => {
    const key = o.kind + ":" + o.name;
    if (!o.name || dropped.has(o.name) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * trigger name -> the function the tree says it executes. Statement-split
 * rather than a spanning regex so a `create trigger` cannot capture the
 * `execute function` of a later statement.
 */
function expectedTriggerTargets(files: string[]): Map<string, { fn: string; file: string }> {
  const targets = new Map<string, { fn: string; file: string }>();
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    for (const stmt of sql.split(";")) {
      const m = stmt.match(/create\s+(?:or\s+replace\s+)?trigger\s+([a-z0-9_"]+)/i);
      if (!m) continue;
      const fn = stmt.match(/execute\s+(?:function|procedure)\s+(?:[a-z0-9_"]+\.)?([a-z0-9_"]+)\s*\(/i);
      if (!fn) continue;
      const strip = (x: string) => x.replace(/"/g, "").toLowerCase();
      targets.set(strip(m[1]), { fn: strip(fn[1]), file });
    }
    // A dropped-and-recreated trigger legitimately changes target; later
    // files win, which the Map already gives us by iteration order.
  }
  return targets;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL. Source an env file first.");
    process.exit(1);
  }
  const asJson = process.argv.includes("--json");
  const files = migrationFiles();
  const corpus = files.map((f) => stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))).join("\n").toLowerCase();
  const expected = expectedFunctionBodies(files);
  // A live name may be Postgres's truncated form of a longer name in the
  // tree, so a prefix match is the correct test in this direction.
  const namedInTree = (name: string) => corpus.includes(name.toLowerCase());

  const findings: Finding[] = [];

  // ---- E. Identifier length (source-tree lint; needs no connection) -------
  const overlong: string[] = [];
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    const re = /create\s+policy\s+"([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const name = m[1];
      if (Buffer.from(name, "utf8").length <= 63) continue;
      if (KNOWN_OVERLONG_POLICY_NAMES.has(name.toLowerCase())) { overlong.push(name); continue; }
      findings.push({
        check: "identifier-length",
        kind: "policy",
        name,
        detail: `${Buffer.from(name, "utf8").length} bytes in ${file}; Postgres truncates policy names at 63 and will store a different string`,
      });
    }
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, application_name: "check-schema-drift" });
  await client.connect();
  let counts: Record<string, number> = {};

  try {
    await client.query("BEGIN TRANSACTION READ ONLY");

    // ---- A. Reverse audit -------------------------------------------------
    // Extension-owned objects are excluded via pg_depend: they are declared by
    // `create extension`, not by naming each function.
    const objectQueries: { kind: string; sql: string }[] = [
      { kind: "function", sql: `select p.proname as name from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')` },
      { kind: "table", sql: `select c.relname as name from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r','p')
            and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')` },
      { kind: "trigger", sql: `select t.tgname as name from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where not t.tgisinternal and n.nspname = 'public'` },
      { kind: "policy", sql: `select policyname as name from pg_policies where schemaname = 'public'` },
    ];
    for (const { kind, sql } of objectQueries) {
      const rows = (await client.query<{ name: string }>(sql)).rows;
      counts[kind] = rows.length;
      for (const { name } of rows) {
        if (PLATFORM_PREFIXES.test(name) || namedInTree(name)) continue;
        findings.push({ check: "reverse-audit", kind, name, detail: "present in the database, named by no migration" });
      }
    }
    // Indexes and constraints are checked by name only when explicitly named in
    // the tree. Auto-named ones (_pkey/_key/_fkey/_check, and constraint-backed
    // indexes) are created implicitly by CREATE TABLE and never appear as
    // literals, so flagging them would be pure noise — their parent table is
    // already covered above.

    // ---- B. Body reconciliation ------------------------------------------
    // Keyed by (name, signature), not name alone — see expectedFunctionBodies's
    // own comment for why: two overloads of the same name (an expand/contract
    // migration's whole point) are different functions with different bodies,
    // and comparing both against a single "last" body produces a false
    // positive on the older, still-correct one.
    const live = (await client.query<{ name: string; args: string; prosrc: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosrc from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_language l on l.oid = p.prolang
        where n.nspname = 'public' and l.lanname in ('plpgsql','sql')
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`
    )).rows;
    counts["function-body"] = live.length;
    for (const fn of live) {
      const key = `${fn.name.toLowerCase()}(${fn.args.toLowerCase()})`;
      const def = expected.get(key);
      if (!def) continue; // already reported by the reverse audit
      if (normaliseBody(def.body) !== normaliseBody(fn.prosrc)) {
        findings.push({
          check: "body-reconciliation",
          kind: "function",
          name: `${fn.name}(${fn.args})`,
          detail: `live body differs from its last definition in ${def.file}`,
        });
      }
    }

    // ---- C. Forward audit -------------------------------------------------
    const liveNames: Record<string, Set<string>> = {
      function: new Set((await client.query<{ name: string }>(
        `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'`)).rows.map((r) => r.name.toLowerCase())),
      table: new Set((await client.query<{ name: string }>(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r','p')`)).rows.map((r) => r.name.toLowerCase())),
      // Deliberately NOT restricted to `public`: the tree also creates
      // policies on storage.objects and triggers on auth.users. Scoping these
      // to public reports every one of them as missing.
      trigger: new Set((await client.query<{ name: string }>(
        `select t.tgname as name from pg_trigger t where not t.tgisinternal`)).rows.map((r) => r.name.toLowerCase())),
      policy: new Set((await client.query<{ name: string }>(
        `select policyname as name from pg_policies`)).rows.map((r) => r.name.toLowerCase())),
    };
    const wanted = expectedObjects(files);
    counts["tree-objects"] = wanted.length;
    for (const obj of wanted) {
      if (liveNames[obj.kind]?.has(truncateIdentifier(obj.name))) continue;
      findings.push({
        check: "forward-audit",
        kind: obj.kind,
        name: obj.name,
        detail: `created by ${obj.file} but absent from this database — migration not applied here`,
      });
    }

    // ---- F. Trigger target ------------------------------------------------
    const liveTriggers = (await client.query<{ name: string; def: string }>(
      `select t.tgname as name, pg_get_triggerdef(t.oid) as def
         from pg_trigger t where not t.tgisinternal`
    )).rows;
    const wantTargets = expectedTriggerTargets(files);
    counts["trigger-target"] = wantTargets.size;
    for (const trg of liveTriggers) {
      const want = wantTargets.get(trg.name.toLowerCase());
      if (!want) continue; // absence is the reverse audit's job, not this one
      const m = trg.def.match(/execute\s+(?:function|procedure)\s+(?:[a-z0-9_"]+\.)?([a-z0-9_"]+)\s*\(/i);
      const actual = m ? m[1].replace(/"/g, "").toLowerCase() : "(unparsed)";
      if (actual !== want.fn) {
        findings.push({
          check: "trigger-target",
          kind: "trigger",
          name: trg.name,
          detail: `fires ${actual}() but ${want.file} defines it as firing ${want.fn}()`,
        });
      }
    }

    // ---- D. Ledger check — SEAM ------------------------------------------
    // Once baselining creates supabase_migrations.schema_migrations, compare
    // its versions against the 14-digit prefixes of migrationFiles() in both
    // directions. A version on disk but not in the ledger means unapplied; a
    // version in the ledger but not on disk means an applied migration was
    // never committed. Until then there is no ledger to read and this is a
    // no-op rather than a failure.
    //
    // A further seam worth having: an environment-comparison mode taking a
    // second DATABASE_URL and diffing RLS flags, policy predicates and grants
    // between two projects. That comparison is what surfaced the staging drift
    // originally; it is omitted here only to keep this check single-target.
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* connection already closing */ }
    await client.end();
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: findings.length === 0, counts, findings }, null, 2));
  } else {
    console.log(`\nSchema drift check — ${files.length} migration files`);
    console.log(Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
    if (overlong.length) {
      console.log(`\n  note: ${overlong.length} policy name(s) exceed 63 bytes and are allowlisted as knowingly accepted.`);
      console.log("        Postgres stores a truncated form. A NEW one fails this check.");
    }
    if (findings.length === 0) {
      console.log("\n  ✓ no drift: every object is accounted for and every function body matches the tree\n");
    } else {
      console.log(`\n  ✗ ${findings.length} drift finding(s):\n`);
      for (const f of findings) console.log(`    [${f.check}] ${f.kind} ${f.name}\n        ${f.detail}`);
      console.log("");
    }
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("check-schema-drift failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * Proves compute_side_out_state() (20260810000110_ranked_side_out_scoring.sql)
 * against a table of rally sequences whose expected states were derived
 * from the pickleball side-out rules BEFORE this function was written —
 * agreed with the CTO in chat, not inferred from what the code produces.
 * If an expectation here is ever edited to match what the code outputs,
 * that row stops being evidence.
 *
 * Covers, per the CTO's explicit list: the opening one-server turn being
 * consumed (rows 2, 4); the second server taking over within a team
 * (row 5); a full side-out crossing the net (row 6); the receiving team
 * winning several rallies in a row and scoring none of them (rows 5+6
 * together — team A wins two straight rallies off team B's serve and
 * scores zero); undo stepping back across each of those boundaries,
 * including un-consuming the opening exception (row 8's three-step
 * chain); and one singles case (row 7) confirming the model collapses
 * correctly when there's no second server to rotate through.
 *
 * Also proves the display-mapping gap the CTO caught: the game's
 * opening server is CALLED "2", never stored that way — see
 * callDoublesScore() and the assertion on row 1.
 *
 * A pure function, so this never touches player data — it's exercised
 * directly via `select * from compute_side_out_state(...)`, no match
 * rows, no players, nothing to clean up. Still gated to staging: it's
 * calling a function that only exists once 20260810000110 is applied,
 * and this project's staging-only scripts all import the same guard on
 * principle, not because this particular script could touch real data.
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-side-out-scoring.ts
 * (after sourcing .env.staging).
 */
import "./assert-staging-env";
import { Client } from "pg";

let failures = 0;

type SideOutState = {
  score_a: number;
  score_b: number;
  serving_team: "a" | "b";
  server_number: number | null;
  first_service_turn_used: boolean;
};

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

/**
 * The display mapping from Gap 1: the state machine stores server_number
 * 1 for the game's opening turn (there's nothing to rotate from), but a
 * pickleball scorekeeper calls that turn "2" — the absence of a first
 * server is what makes losing it an immediate side-out. This function is
 * the spec for wherever the UI eventually formats a doubles score; it
 * belongs in TypeScript, not in the SQL fold, on purpose.
 */
function callDoublesScore(s: SideOutState): string {
  const serverScore = s.serving_team === "a" ? s.score_a : s.score_b;
  const receiverScore = s.serving_team === "a" ? s.score_b : s.score_a;
  const calledServerNumber = s.first_service_turn_used ? s.server_number : 2;
  return `${serverScore}-${receiverScore}-${calledServerNumber}`;
}

type Row = {
  label: string;
  matchType: "singles" | "doubles";
  rallyWinners: Array<"a" | "b">;
  expected: SideOutState;
  expectedCalledScore?: string;
};

// Rules-derived, not code-derived — see file header.
const ROWS: Row[] = [
  {
    label: "1: baseline, no rallies yet",
    matchType: "doubles",
    rallyWinners: [],
    expected: { score_a: 0, score_b: 0, serving_team: "a", server_number: 1, first_service_turn_used: false },
    expectedCalledScore: "0-0-2", // Gap 1: stored server_number is 1, CALLED score is 2.
  },
  {
    label: "2: opening turn consumed on the very first rally",
    matchType: "doubles",
    rallyWinners: ["b"],
    expected: { score_a: 0, score_b: 0, serving_team: "b", server_number: 1, first_service_turn_used: true },
  },
  {
    label: "3: serving team keeps winning, exception not yet triggered",
    matchType: "doubles",
    rallyWinners: ["a", "a", "a"],
    expected: { score_a: 3, score_b: 0, serving_team: "a", server_number: 1, first_service_turn_used: false },
  },
  {
    label: "4: exception consumes on whichever rally the server first loses",
    matchType: "doubles",
    rallyWinners: ["a", "a", "b"],
    expected: { score_a: 2, score_b: 0, serving_team: "b", server_number: 1, first_service_turn_used: true },
  },
  {
    label: "5: second server takes over — receiving team scores nothing",
    matchType: "doubles",
    rallyWinners: ["b", "a"],
    expected: { score_a: 0, score_b: 0, serving_team: "b", server_number: 2, first_service_turn_used: true },
  },
  {
    label: "6: full side-out crossing the net — two straight receiving wins, zero points",
    matchType: "doubles",
    rallyWinners: ["b", "a", "a"],
    expected: { score_a: 0, score_b: 0, serving_team: "a", server_number: 1, first_service_turn_used: true },
  },
  {
    label: "7 (singles): winning back the serve is never itself a point",
    matchType: "singles",
    rallyWinners: ["a", "a", "b", "a"],
    expected: { score_a: 2, score_b: 0, serving_team: "a", server_number: null, first_service_turn_used: false },
  },
  {
    label: "8a: undo chain, step 1 — must equal row 5 exactly",
    matchType: "doubles",
    rallyWinners: ["b", "a"], // row 6's log minus its last rally
    expected: { score_a: 0, score_b: 0, serving_team: "b", server_number: 2, first_service_turn_used: true },
  },
  {
    label: "8b: undo chain, step 2 — must equal row 2 exactly",
    matchType: "doubles",
    rallyWinners: ["b"],
    expected: { score_a: 0, score_b: 0, serving_team: "b", server_number: 1, first_service_turn_used: true },
  },
  {
    label: "8c: undo chain, step 3 — must equal row 1 exactly, INCLUDING un-consuming the opening exception",
    matchType: "doubles",
    rallyWinners: [],
    expected: { score_a: 0, score_b: 0, serving_team: "a", server_number: 1, first_service_turn_used: false },
  },
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  for (const row of ROWS) {
    const { rows } = await client.query(
      `select score_a, score_b, serving_team, server_number, first_service_turn_used
       from compute_side_out_state($1::text[], $2)`,
      [row.rallyWinners, row.matchType]
    );
    const actual: SideOutState = rows[0];
    assertEqual(row.label, actual, row.expected);
    if (row.expectedCalledScore !== undefined) {
      assertEqual(`${row.label} — called score`, callDoublesScore(actual), row.expectedCalledScore);
    }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

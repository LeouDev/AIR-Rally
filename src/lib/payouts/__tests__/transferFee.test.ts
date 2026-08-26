import * as fs from "fs";
import * as path from "path";
import { PAYOUT_TRANSFER_FEE_CENTAVOS } from "../transferFee";

/**
 * The TS constant mirrors `public.payout_transfer_fee_centavos()`, and the
 * SQL function is the source of truth — every real transfer row takes its
 * `provider_fee` from the database, never from here.
 *
 * That makes drift between them nearly invisible: a real payslip always
 * shows the stored fee, so only a PREVIEW could ever display the mirrored
 * value. A disagreement would therefore never surface in production, on any
 * document a venue owner reads. This test is the only thing that would
 * catch it.
 *
 * It reads the value out of the migration rather than restating it, so a
 * change to the SQL that isn't mirrored here fails — restating the number
 * would just assert the constant equals itself.
 */

const MIGRATION = path.join(
  __dirname,
  "../../../../supabase/migrations/20260810000092_payout_transfer_attestation.sql"
);

function feeFromMigration(): number {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  // create or replace function public.payout_transfer_fee_centavos() ... as $$ select 1000 $$;
  const match = sql.match(
    /function\s+public\.payout_transfer_fee_centavos\(\)[\s\S]*?as\s+\$\$\s*select\s+(\d+)\s*\$\$/i
  );
  if (!match) throw new Error("Could not read the fee out of migration 092 — has the function been renamed or reshaped?");
  return Number(match[1]);
}

describe("payout transfer fee", () => {
  it("matches the SQL function it mirrors", () => {
    expect(PAYOUT_TRANSFER_FEE_CENTAVOS).toBe(feeFromMigration());
  });

  // Guards the extraction itself: if the regex silently stopped matching and
  // returned something falsy, the assertion above could pass vacuously.
  it("actually found a value in the migration", () => {
    expect(feeFromMigration()).toBeGreaterThan(0);
  });

  /**
   * CENTAVOS, NOT PESOS. 10 would mean ten centavos — a 100x error in the
   * one place nobody looks twice, because "10" matches the "₱10" in the
   * owner agreement. Anchored to the agreement's own §3.2 worked example: a
   * ₱400.00 court price is stored as 40000, so ₱10.00 is 1000.
   */
  it("is expressed in centavos, anchored to the agreement's worked example", () => {
    const phpFourHundredInCentavos = 40000;
    expect(PAYOUT_TRANSFER_FEE_CENTAVOS).toBe(1000);
    expect(PAYOUT_TRANSFER_FEE_CENTAVOS / phpFourHundredInCentavos).toBeCloseTo(0.025);
  });
});

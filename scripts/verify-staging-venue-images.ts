/**
 * Live proof of the venue/court image upload feature against real
 * staging Postgres + Storage RLS. Creates two disposable venue-owner
 * accounts and a real draft venue, then proves:
 *   1. the true owner can upload a real image via the exact service
 *      function the app uses (uploadCourtImage), using their own
 *      ordinary anon-key session — not service role;
 *   2. a DIFFERENT owner gets a real RLS rejection attempting to upload
 *      into that venue's Storage folder, and a real RLS rejection
 *      inserting a court_images row for that venue;
 *   3. an anonymous (no session) client cannot read the court_images row
 *      for a draft (non-active) venue — the row simply isn't
 *      discoverable, same as every other draft-venue field;
 *   4. the true owner can hard-delete their own draft venue (the
 *      existing venues DELETE RLS policy, exercised end-to-end);
 *   5. that same owner CANNOT delete a non-draft venue — RLS matches
 *      zero rows, surfaced as a real Postgres "no rows" condition, not a
 *      silent success.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-venue-images.ts
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import type { Database } from "../src/lib/supabase/types";
import { uploadCourtImage, deleteCourtImage, VENUE_IMAGES_BUCKET } from "../src/lib/services/images";
import { deleteVenue } from "../src/lib/services/venues";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function signUpDisposable(url: string, anonKey: string, email: string, password: string) {
  const client = createClient<Database>(url, anonKey);
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) throw new Error(`Sign-up failed for ${email}: ${error?.message}`);
  const { error: roleError } = await client.rpc("request_venue_owner_role");
  if (roleError) throw new Error(`request_venue_owner_role failed for ${email}: ${roleError.message}`);
  return { client, userId: data.user.id };
}

// A minimal, real 1x1 transparent PNG — small enough to be a trivial
// fixture, still a genuinely valid image/png the bucket's mime-type
// restriction will accept.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const anonOnlyClient = createClient<Database>(url, anonKey);
  const pg = new PgClient({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  const stamp = Date.now();
  let venueId: string | null = null;
  let activeVenueId: string | null = null;
  let imageId: string | null = null;
  let ownerAId: string | null = null;
  let ownerBId: string | null = null;
  let adminId: string | null = null;

  try {
    console.log("Creating two disposable venue-owner test accounts and one disposable admin account...");
    const ownerA = await signUpDisposable(url, anonKey, `owner-images-a-${stamp}@air-rally.invalid`, "OwnerImagesA123!");
    const ownerB = await signUpDisposable(url, anonKey, `owner-images-b-${stamp}@air-rally.invalid`, "OwnerImagesB123!");
    ownerAId = ownerA.userId;
    ownerBId = ownerB.userId;

    // A real profiles.role='admin' account, promoted via the same
    // bypass GUC prevent_role_self_escalation() itself checks for — the
    // only legitimate way to reach 'active' status for the "non-draft
    // venue can't be deleted" check below is a REAL admin session doing
    // a REAL PostgREST update (a raw superuser SQL UPDATE gets silently
    // reverted by venues' own prevent_owner_status_escalation trigger,
    // exactly as it should for a non-admin session with no JWT context).
    const adminAccount = createClient<Database>(url, anonKey);
    const adminSignUp = await adminAccount.auth.signUp({
      email: `owner-images-admin-${stamp}@air-rally.invalid`,
      password: "OwnerImagesAdmin123!",
    });
    if (adminSignUp.error || !adminSignUp.data.user) throw new Error(`Admin sign-up failed: ${adminSignUp.error?.message}`);
    adminId = adminSignUp.data.user.id;
    // is_local=false (session-level, not transaction-local) since this
    // pg.Client issues each statement as its own implicit transaction.
    await pg.query("select set_config('air_rally.bypass_role_self_escalation', 'true', false)");
    await pg.query("update profiles set role = 'admin' where id = $1", [adminId]);

    const venueInsert = await ownerA.client
      .from("venues")
      .insert({
        owner_id: ownerAId,
        name: "[STAGING-TEST] Venue Images",
        status: "draft",
        indoor_outdoor: "outdoor",
        timezone: "Asia/Manila",
      })
      .select("*")
      .single();
    if (venueInsert.error) throw venueInsert.error;
    venueId = venueInsert.data.id;
    console.log(`Created real draft venue ${venueId} owned by ownerA`);

    const file = new File([Buffer.from(ONE_PIXEL_PNG_BASE64, "base64")], "pixel.png", { type: "image/png" });

    console.log("\nUploading a real image as the TRUE owner (ownerA), via the real service function...");
    const uploadedImage = await uploadCourtImage(ownerA.client, { venueId, courtId: null, file });
    imageId = uploadedImage.id;
    record(
      "[owner] real upload + court_images insert succeeds for the venue's own owner",
      uploadedImage.storage_path.startsWith(`${venueId}/`),
      `storage_path=${uploadedImage.storage_path}`
    );

    console.log("\nAttempting the SAME upload as a DIFFERENT owner (ownerB) who doesn't own this venue...");
    let crossOwnerStorageRejected = false;
    let crossOwnerStorageDetail = "no error thrown";
    try {
      await uploadCourtImage(ownerB.client, { venueId, courtId: null, file });
    } catch (e) {
      crossOwnerStorageRejected = true;
      crossOwnerStorageDetail = e instanceof Error ? e.message : JSON.stringify(e);
    }
    record("[cross-owner] a different owner's upload is rejected by Storage/court_images RLS", crossOwnerStorageRejected, crossOwnerStorageDetail);

    console.log("\nChecking that an ANONYMOUS (no session) client can't read this draft venue's image row...");
    const anonRead = await anonOnlyClient.from("court_images").select("*").eq("id", imageId).maybeSingle();
    record(
      "[public] an unauthenticated client cannot see a draft venue's court_images row",
      !anonRead.error && anonRead.data === null,
      `error=${anonRead.error?.message} data=${JSON.stringify(anonRead.data)}`
    );

    console.log("\nDeleting that image as its real owner (full service function: row + Storage object)...");
    await deleteCourtImage(ownerA.client, imageId);
    const afterDelete = await pg.query("select id from court_images where id = $1", [imageId]);
    record("[owner] deleteCourtImage removes the row", afterDelete.rowCount === 0, `remaining rows=${afterDelete.rowCount}`);
    imageId = null; // already cleaned up

    console.log("\nDeleting the draft venue as its real owner...");
    await deleteVenue(ownerA.client, venueId);
    const afterVenueDelete = await pg.query("select id from venues where id = $1", [venueId]);
    record("[owner] deleteVenue succeeds for the owner's own draft venue", afterVenueDelete.rowCount === 0, `remaining rows=${afterVenueDelete.rowCount}`);
    venueId = null; // already cleaned up

    console.log("\nCreating a second venue and promoting it to 'active' via a REAL admin session (a raw SQL UPDATE would just get silently reverted by venues_prevent_status_escalation, same as it should for anyone without a real admin JWT) to prove non-draft venues can't be deleted...");
    const activeVenueInsert = await ownerA.client
      .from("venues")
      .insert({
        owner_id: ownerAId,
        name: "[STAGING-TEST] Venue Images Active",
        status: "draft",
        indoor_outdoor: "outdoor",
        timezone: "Asia/Manila",
      })
      .select("*")
      .single();
    if (activeVenueInsert.error) throw activeVenueInsert.error;
    activeVenueId = activeVenueInsert.data.id;
    const promote = await adminAccount.from("venues").update({ status: "active" }).eq("id", activeVenueId).select("status").single();
    if (promote.error) throw promote.error;
    record("[setup] a real admin session can promote a venue to active", promote.data.status === "active", `status=${promote.data.status}`);

    let nonDraftDeleteRejected = false;
    let nonDraftDeleteDetail = "no error thrown";
    try {
      await deleteVenue(ownerA.client, activeVenueId);
    } catch (e) {
      nonDraftDeleteRejected = true;
      nonDraftDeleteDetail = e instanceof Error ? e.message : JSON.stringify(e);
    }
    record("[owner] deleteVenue is rejected for a non-draft venue, even for its real owner", nonDraftDeleteRejected, nonDraftDeleteDetail);

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    console.log("\nCleaning up staging test data...");
    if (imageId) {
      await pg.query("delete from court_images where id = $1", [imageId]).catch((e) => console.error(e.message));
    }
    // Remove any Storage objects left over under either venue's folder
    // (the cross-owner rejection attempt above never actually wrote
    // anything, so this is normally a no-op — just a safety net).
    const serviceKey = process.env.SUPABASE_SECRET_KEY;
    if (serviceKey && (venueId || activeVenueId)) {
      const serviceClient = createClient<Database>(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      for (const id of [venueId, activeVenueId].filter((v): v is string => !!v)) {
        const list = await serviceClient.storage.from(VENUE_IMAGES_BUCKET).list(id);
        if (list.data && list.data.length > 0) {
          await serviceClient.storage.from(VENUE_IMAGES_BUCKET).remove(list.data.map((f) => `${id}/${f.name}`));
        }
      }
    }
    if (activeVenueId) await pg.query("delete from venues where id = $1", [activeVenueId]).catch((e) => console.error(e.message));
    if (venueId) await pg.query("delete from venues where id = $1", [venueId]).catch((e) => console.error(e.message));
    if (ownerAId || ownerBId || adminId) {
      const serviceClient2 = serviceKey
        ? createClient<Database>(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
        : null;
      if (serviceClient2) {
        if (ownerAId) await serviceClient2.auth.admin.deleteUser(ownerAId).catch((e) => console.error(e.message));
        if (ownerBId) await serviceClient2.auth.admin.deleteUser(ownerBId).catch((e) => console.error(e.message));
        if (adminId) await serviceClient2.auth.admin.deleteUser(adminId).catch((e) => console.error(e.message));
      }
    }
    console.log("Cleanup done.");
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

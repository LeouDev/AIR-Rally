/**
 * @jest-environment node
 */
import { GET } from "../route";

/**
 * Universal Links fail SILENTLY when this file is wrong — no error anywhere,
 * links just keep opening Safari. And Apple caches the response, so a wrong
 * version persists on devices that already fetched it. These assertions are
 * cheaper than discovering it from a user report.
 */
describe("apple-app-site-association", () => {
  it("serves application/json — the extensionless path infers nothing", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    // Not toContain: a charset suffix is fine, but octet-stream is the actual
    // failure mode and would still "contain" nothing useful.
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  });

  it("is valid JSON with the shape Apple parses", async () => {
    const body = await GET().json();
    expect(body.applinks.details).toHaveLength(1);
    expect(body.applinks.details[0].appID).toBe("Z5643XKUTZ.com.airrally.app");
  });

  /**
   * The appID is TEAMID.BUNDLEID and both halves are verified against the
   * mobile repo (eas.json appleTeamId, app.json bundleIdentifier). A mismatch
   * in either is undetectable at runtime — iOS simply declines the association.
   */
  it("uses the team and bundle ids the app actually ships with", async () => {
    const body = await GET().json();
    const [team, ...bundle] = body.applinks.details[0].appID.split(".");
    expect(team).toBe("Z5643XKUTZ");
    expect(bundle.join(".")).toBe("com.airrally.app");
  });

  /**
   * Scope: exactly the pages the app can open, checked against real URLs
   * rather than the literal list, so a too-broad pattern (say "/ranked/*",
   * which would swallow the public results page) fails here. Widened from
   * /courts/* once the app could replay a link after sign-in — the old
   * objection was a signed-out player stranded on a login wall.
   */
  const matches = (pattern: string, path: string) =>
    new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.?+^$()[\]{}|\\]/g, "\\$&")).join(".*")}$`).test(path);

  it.each([
    "/courts/abc",
    "/bookings",
    "/bookings/abc/confirmation",
    "/events",
    "/events/e1",
    "/clubs/c1",
    "/court-side/u1",
    "/court-side/club/c1",
    "/ranked/match/m1",
    "/ranked/leaderboard",
    "/notifications",
    "/profile/credits",
    "/profile/rank/history",
  ])("hands %s to the app", async (path) => {
    const paths: string[] = (await GET().json()).applinks.details[0].paths;
    expect(paths.some((pattern) => matches(pattern, path))).toBe(true);
  });

  it.each([
    "/",
    "/ranked/results/m1",
    "/venues/requests/r1",
    "/payment-return",
    "/admin/payouts",
    "/list-your-court/bookings",
    "/owner/onboarding",
    "/auth/callback",
    "/login",
    "/bookings/abc",
  ])("leaves %s to the web", async (path) => {
    const paths: string[] = (await GET().json()).applinks.details[0].paths;
    expect(paths.some((pattern) => matches(pattern, path))).toBe(false);
  });
});

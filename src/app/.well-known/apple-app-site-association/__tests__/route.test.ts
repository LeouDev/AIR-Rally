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
   * Scope is a product decision, not a detail. /courts/* is the only public,
   * non-auth-gated route the app shares; ranked results and COURT/Side posts
   * are sign-in gated, so a Universal Link to one drops a first-time visitor
   * onto a login wall inside the app — worse than the web page they tapped.
   */
  it("claims only /courts/*, not the whole domain", async () => {
    const body = await GET().json();
    const paths: string[] = body.applinks.details[0].paths;
    expect(paths).toEqual(["/courts/*"]);
    expect(paths).not.toContain("*");
    expect(paths).not.toContain("/*");
  });
});

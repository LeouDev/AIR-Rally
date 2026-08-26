import {
  TERMS_VERSIONS,
  ALL_LEGAL_VERSIONS,
  hashLegalDocument,
  currentTermsHash,
} from "../versions";
import { TERMS } from "@/lib/legalContent";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/legal";
import manifest from "../manifest.json";

/**
 * THE ENFORCEMENT. Human review is demonstrably not the control here — the
 * §7 divergence that put a false promise on the live site passed review,
 * and so did the mobile commit that changed the text without bumping the
 * version. A one-line edit inside a file full of prose is exactly what a
 * reviewer waves through.
 *
 * These run in CI on every commit, and they cover the CURRENT version as
 * well as the frozen ones. That is what forces a version bump rather than
 * an in-place edit: change any word of the Terms and its hash moves, this
 * fails, and the only way to make it pass is to add a new version — which
 * is a visible, deliberate act rather than a side effect of a copy edit.
 */
type DocKey = keyof typeof ALL_LEGAL_VERSIONS;
const DOC_KEYS = Object.keys(ALL_LEGAL_VERSIONS) as DocKey[];
const hashes = manifest as unknown as Record<string, Record<string, string>>;

describe("legal version integrity", () => {
  // EVERY document, not only the Terms. The Venue Owner Agreement is the
  // next one due to change (payout clauses 3.9-3.12), and covering only
  // Terms would have meant the very next legal edit bypassed the machinery
  // built to catch exactly that.
  it.each(
    DOC_KEYS.flatMap((doc) =>
      Object.keys(hashes[doc]).map((v) => [doc, v] as const),
    ),
  )("%s/%s still hashes to its manifest entry", (doc, version) => {
    const found = ALL_LEGAL_VERSIONS[doc][version];
    expect(found).toBeDefined();
    expect(hashLegalDocument(found)).toBe(hashes[doc][version]);
  });

  // Catches the reverse: a version added to the code without a manifest
  // entry would otherwise be unprotected, since the loop above only walks
  // the manifest.
  it.each(DOC_KEYS)(
    "every %s version in the code has a manifest entry",
    (doc) => {
      for (const version of Object.keys(ALL_LEGAL_VERSIONS[doc])) {
        expect(Object.keys(hashes[doc])).toContain(version);
      }
    },
  );

  it("covers all three documents, so none is silently unprotected", () => {
    expect(DOC_KEYS.sort()).toEqual(["ownerAgreement", "privacy", "terms"]);
  });

  it("the current version constant resolves to a real document", () => {
    expect(TERMS_VERSIONS[CURRENT_AGREEMENT_VERSION]).toBe(TERMS);
    expect(currentTermsHash()).toBe(
      manifest.terms[CURRENT_AGREEMENT_VERSION as keyof typeof manifest.terms],
    );
  });
});

describe("the superseded text is actually preserved", () => {
  /**
   * The specific words this whole exercise exists to keep. 2026-08-17 told
   * users their Credits came back on cancellation; the code has always
   * refused to cancel such a booking at all. Seven production acceptances
   * name this version, and without it frozen here the only record of what
   * they agreed to would be git history.
   */
  it("2026-08-17 still says Credits are returned on cancellation", () => {
    const credits = TERMS_VERSIONS["2026-08-17"].sections.find((s) =>
      s.heading.startsWith("7."),
    );
    expect(credits?.body.join(" ")).toContain(
      "the Credits portion is returned to your Credits balance",
    );
  });

  it("and the current version says the opposite, which is what the code does", () => {
    const credits = TERMS_VERSIONS[CURRENT_AGREEMENT_VERSION].sections.find(
      (s) => s.heading.startsWith("7."),
    );
    expect(credits?.body.join(" ")).toContain(
      "cannot be cancelled or rescheduled",
    );
    expect(credits?.body.join(" ")).not.toContain(
      "the Credits portion is returned",
    );
  });

  // Two versions hashing the same would mean the freeze silently aliased
  // rather than preserving — the failure would look like success.
  it("the two versions are genuinely different documents", () => {
    expect(hashLegalDocument(TERMS_VERSIONS["2026-08-17"])).not.toBe(
      currentTermsHash(),
    );
  });
});

describe("hashing ignores formatting but not words", () => {
  it("reformatting whitespace does not change the hash", () => {
    const reflowed = {
      ...TERMS,
      intro: TERMS.intro.map((p) => `  ${p.replace(/ /g, "  ")}  `),
    };
    expect(hashLegalDocument(reflowed)).toBe(currentTermsHash());
  });

  it("changing a single word does change it", () => {
    const altered = {
      ...TERMS,
      intro: [
        TERMS.intro[0].replace("AIR/Rally", "AIR/Rallyy"),
        ...TERMS.intro.slice(1),
      ],
    };
    expect(hashLegalDocument(altered)).not.toBe(currentTermsHash());
  });

  // reviewNote is a question for counsel, hidden from the public pages and
  // never part of what anyone accepted. If it fed the hash, a note to a
  // lawyer would register as an amendment to a contract.
  it("a reviewNote is not part of the accepted document", () => {
    const withNote = {
      ...TERMS,
      sections: TERMS.sections.map((s, i) =>
        i === 0 ? { ...s, reviewNote: "ask counsel about this" } : s,
      ),
    };
    expect(hashLegalDocument(withNote)).toBe(currentTermsHash());
  });
});

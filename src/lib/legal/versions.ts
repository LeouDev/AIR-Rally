import { createHash } from "crypto";
import type { LegalDocument } from "@/lib/legalContent";
import { TERMS, OWNER_AGREEMENT, PRIVACY } from "@/lib/legalContent";
import {
  CURRENT_AGREEMENT_VERSION,
  CURRENT_OWNER_AGREEMENT_VERSION,
} from "@/lib/legal";
import { TERMS_2026_08_17, OWNER_AGREEMENT_1_0 } from "./frozen";

/**
 * Every version of the User Agreement that has ever been accepted, keyed by
 * the string recorded against an acceptance.
 *
 * WHY THIS EXISTS. `agreement_acceptances.agreement_version` is free text,
 * which records WHICH version someone accepted but not WHAT IT SAID. That
 * distinction is the whole thing: a user who accepted "2026-08-17" is owed
 * an answer to "what did I agree to", and until now the only place that
 * answer lived was git history.
 *
 * It has already failed twice. Terms §7 was corrected in the mobile repo
 * and never in this one, so the two clients wrote different version strings
 * for what should have been one document — and the fix (commit c5e0c07)
 * would have destroyed the superseded wording had it not been recovered and
 * frozen.
 *
 * APPEND-ONLY. Adding a version is normal; changing one is not. Frozen
 * entries live in ./frozen.ts and must never be edited.
 *
 * `2026-08-16` is deliberately absent: it was placeholder text, superseded
 * the next day, and has ZERO acceptances on production — there is no row
 * pointing at it and so nothing to answer.
 */
export const TERMS_VERSIONS: Record<string, LegalDocument> = {
  "2026-08-17": TERMS_2026_08_17,
  // The current text is NOT duplicated here — it is the live TERMS export,
  // so the two can never disagree about what "current" says. The hash
  // manifest covers it all the same, which is what forces a version bump
  // rather than an in-place edit.
  [CURRENT_AGREEMENT_VERSION]: TERMS,
};

/**
 * Every version of the Venue Owner Agreement. Owners accept this at
 * application time and the version is recorded on
 * `owner_applications.agreement_version`.
 *
 * `1.0` is the only version so far, and it is the LIVE text rather than a
 * frozen copy — nothing has superseded it yet. The moment it is amended,
 * the manifest below will fail, and making it pass means bumping to `1.1`
 * and freezing `1.0` in ./frozen.ts. That is the machinery doing its job on
 * its first real use rather than being bypassed by it.
 */
export const OWNER_AGREEMENT_VERSIONS: Record<string, LegalDocument> = {
  "1.0": OWNER_AGREEMENT_1_0,
  [CURRENT_OWNER_AGREEMENT_VERSION]: OWNER_AGREEMENT,
};

/**
 * The Privacy Policy, which nobody "accepts" — there is no acceptance row
 * and so no version constant. It is covered here anyway so that an edit is
 * a deliberate act rather than a quiet one: changing it fails the manifest,
 * and the fix is updating the recorded hash, which is visible in review as
 * "I changed the privacy policy" rather than one line inside a wall of
 * prose. Keyed "current" because there is no version scheme to key it by.
 */
export const PRIVACY_VERSIONS: Record<string, LegalDocument> = {
  current: PRIVACY,
};

/** Every legal document under hash protection, by the manifest's own keys. */
export const ALL_LEGAL_VERSIONS = {
  terms: TERMS_VERSIONS,
  ownerAgreement: OWNER_AGREEMENT_VERSIONS,
  privacy: PRIVACY_VERSIONS,
} as const;

/**
 * A stable fingerprint of a document's words.
 *
 * Normalises whitespace so reformatting — prettier, a line rewrap, an
 * editor — never registers as a change to the agreement. Only the words
 * count, because only the words are what someone accepted.
 *
 * `reviewNote` is excluded: it is a question for counsel, hidden from the
 * public pages, and never part of the accepted document. Including it would
 * make a note to a lawyer look like an amendment to a contract.
 */
export function hashLegalDocument(doc: LegalDocument): string {
  const canonical = JSON.stringify({
    title: doc.title.replace(/\s+/g, " ").trim(),
    intro: doc.intro.map((p) => p.replace(/\s+/g, " ").trim()),
    sections: doc.sections.map((s) => ({
      heading: s.heading.replace(/\s+/g, " ").trim(),
      body: s.body.map((p) => p.replace(/\s+/g, " ").trim()),
    })),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * The hash recorded against an acceptance, so a row proves WHICH WORDS were
 * accepted rather than only which label the client sent.
 *
 * That matters specifically because the label has already proved
 * unreliable: web and mobile keep separate copies of both the text and the
 * version constant, and between 2026-08-17 and 2026-08-26 they disagreed —
 * so a version string identified which app someone signed up in rather than
 * which document they read.
 *
 * COMPUTED SERVER-SIDE, FROM THE SERVER'S OWN COPY, NEVER FROM A CLIENT
 * VALUE. A client-supplied hash proves only what the client claimed. The
 * honest limitation: it records what the SERVER holds, so if a client
 * displayed different text, this records the server's version and not what
 * the user actually saw. Detecting that needs a shared source; this makes
 * it answerable rather than preventing it.
 */
export function currentTermsHash(): string {
  return hashLegalDocument(TERMS);
}

/**
 * Display-only normalization for a venue's contact phone number — never
 * touches what's actually stored (see lib/validations/shared.ts's
 * phoneRegex, which deliberately accepts a wide range of raw formats so
 * this stays a display concern, not a stricter input rule that could
 * reject a legitimate number shape it hasn't been tested against).
 *
 * Fixes one specific, observed bug: a live-site audit found the same
 * underlying PH mobile number displayed as "9399029892" on one venue's
 * page and "09399029892" on another — the trunk `0` was missing from one
 * venue's stored value, and the tel: link/visible text render whatever
 * is stored verbatim. A 10-digit PH mobile subscriber number is only ever
 * valid with that leading 0 (or a country code); without it, the number
 * is one digit short of dialable on plenty of phones.
 *
 * Deliberately narrow: only ever prepends the missing 0 to the exact
 * shape this bug produces (10 digits, starting with 9 — the PH mobile
 * prefix). Every other shape (already has 0, has +63, a landline, an
 * international number, anything with extra punctuation) is returned
 * untouched rather than guessed at.
 */
export function formatPhilippinePhoneForDisplay(phone: string): string {
  const trimmed = phone.trim();
  const digitsOnly = trimmed.replace(/[\s\-().]/g, "");
  if (/^9\d{9}$/.test(digitsOnly)) {
    return `0${digitsOnly}`;
  }
  return trimmed;
}

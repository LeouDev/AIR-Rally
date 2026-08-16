/**
 * Money formatting for settlement views. Shared by the owner panel and the
 * admin pages so a peso is rendered identically in both — the existing
 * pages each carried their own local copy of this, which is fine for one
 * page and a drift risk across three.
 *
 * Input is always integer minor units (centavos), never a float.
 */
export function formatSettlementMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  const negative = amountMinorUnits < 0;
  const absolute = Math.abs(amountMinorUnits);
  return `${negative ? "−" : ""}${symbol}${(absolute / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

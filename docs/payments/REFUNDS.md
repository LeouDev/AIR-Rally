# Refunds

**Refunds are issued as AIR/Rally Credits. There is no path that returns money.**

That is not a policy preference, it is a constraint. QR Ph payments cannot be
refunded through PayMongo's API at all — confirmed against the live API, and
encoded as `REFUND_UNSUPPORTED_SOURCE_TYPES = ["qrph"]` in
`src/lib/services/refunds.ts`. QR Ph is the only enabled payment method
(`PAYMENT_METHOD_TYPES` in `src/lib/services/paymongo.ts`), so **every** payment
this platform takes is unrefundable by API. The alternative to credit is a
manual bank transfer, performed by a human, outside every system of record.

Credit is therefore the mechanism, and this document is how to use it.

---

## The amount: what the customer actually paid

**Refund `price_amount + processing_fee_amount`, not `price_amount`.**

Since the processing-fee pass-through went live, the customer is charged the
court price *plus* PayMongo's fee. A ₱1200 court is an ₱1218.27 charge. Refunding
₱1200 leaves the customer ₱18.27 out of pocket for a booking they did not get —
for a fee they only paid because they used the platform.

`calculateAmountPaid()` in `src/lib/services/bookingFee.ts` is the single source
of that number, and the refund script uses it. Do not compute it by hand.

### Credit is not subtracted

`calculateAmountPaid()` deliberately ignores `credit_amount_applied`. A booking
half-settled from the wallet still **cost** the customer its full price — half
from the wallet, half from their bank. Both halves come back as credit.

Two different numbers exist here and confusing them is the easiest mistake:

| Number | Meaning | Formula |
|---|---|---|
| **What the customer paid** | what you refund | `price_amount + processing_fee_amount` |
| What PayMongo collected | reconciliation only | `price_amount - credit_amount_applied + processing_fee_amount` |

They diverge only when credit was applied — which is exactly when a wrong choice
looks like a bug and shortchanges the customer.

### On refunding the fee

AIR/Rally has already paid the processing fee to PayMongo and does not get it
back. Refunding it in credit therefore costs AIR/Rally the fee — but at cost of
credit, not cash, and only if the customer books again. Not refunding it means
charging a customer ₱18.27 for a booking that did not happen, which is not
defensible for a venue cancellation or a system error. **Refund it.** The script
does this by default.

---

## Policy

`resolveCancellationCredit()` in `src/lib/services/credits.ts` is the authority;
this table is a summary of it, not a second implementation.

| Cause | Outcome |
|---|---|
| `customer` — cancelled 48h+ before start | full credit |
| `customer` — cancelled inside 48h | **no credit** |
| `venue` — the venue cancelled | full credit, regardless of timing |
| `venue_unavailable` — the venue could not honour it | full credit, regardless of timing |
| `system_error` — a system or payment fault | full credit, regardless of timing |
| `support_review` — a deliberate support decision | full credit, regardless of timing |

The cutoff is `CANCELLATION_CREDIT_CUTOFF_HOURS = 48` in
`src/lib/booking-config.ts`. It applies **only** when the customer is the cause.
Nothing the customer did not cause is ever subject to it.

If you want to compensate a within-48h customer cancellation anyway, use
`--cause support_review` — a recorded, deliberate decision — rather than
overriding the amount silently.

---

## Doing it

Always dry-run first. The script issues nothing without `--confirm`.

```bash
set -a && source .env.production && set +a
TS_NODE_BASEURL=. TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
  node -r ts-node/register -r tsconfig-paths/register \
  scripts/issue-refund-credit.ts --code A6CCE76E --cause customer
```

It prints the booking, the amount the customer actually paid, the policy
decision and what it would issue. Re-run with `--confirm` to issue.

```bash
… scripts/issue-refund-credit.ts --code A6CCE76E --cause customer --confirm
```

Partial refunds: `--amount <centavos> --note "why"`. Use rarely, and always with
a note — it is written into the ledger description and is the only record of why
the amount differed from policy.

### What the script refuses, and why

- **A booking that was never paid** (`paid_at` is null). Most `pending` bookings
  are abandoned checkouts where no money ever moved. This is the single most
  likely thing to be refunded by mistake.
- **A second refund for the same booking.** Credit is money-like and
  `credit_transactions` is immutable — there is no undo, only an offsetting
  negative adjustment, which is a worse audit trail than never double-issuing.
- **An unknown confirmation code, or a cause outside the five above.**

---

## What NOT to do

**Do not write to `booking_refunds`.** That table models *provider* refunds: it
requires a real `provider_payment_id`, and its
`platform_refund_amount` / `venue_refund_amount` / `provider_available_at`
columns are populated only from a genuine PayMongo `split_refund` response, never
computed locally (see migration `20260810000014`).
`src/lib/services/refunds.ts` is its only legitimate writer. A credit refund is
not a provider refund, and putting one there would make the reconciliation view
claim PayMongo returned money it never returned.

**The credit ledger is the audit trail.** `credit_transactions` rows carry
`transaction_type = 'cancellation_compensation'` and `reference_id = <booking id>`,
which is what makes the refund attributable to a booking and what the
double-issue check reads.

**Do not issue credit with raw SQL.** `credit_transactions` has no client
INSERT/UPDATE/DELETE policy at all; `user_credit_wallets.balance` is derived by
trigger. Writing the ledger by hand risks a balance that disagrees with its own
ledger — the exact invariant migration `20260810000036` exists to protect.

---

## The refund does not cancel the booking

`issue-refund-credit.ts` issues credit and nothing else. If the booking also
needs cancelling, do that separately — and note the ordering:

Cancelling a **pending** booking automatically restores any credit that was
applied to it, via the restore trigger from migration `20260810000037`. Cancelling
a **confirmed** booking does not. So for a confirmed booking, issuing the refund
credit and cancelling are two independent actions and both are needed. For a
pending booking, there is normally nothing to refund at all, because nothing was
paid.

---

## Notification

Issuing credit notifies the customer automatically — credit *issues* notify,
credit *spends* do not (verified by `scripts/verify-staging-credits.ts`). You do
not need to tell them separately that the credit landed, though you should still
tell them **why**.

---

## Open items

- **No admin UI.** `issueCancellationCredit()` in `credits.ts` is described in
  its own doc comment as "the reusable hook a future cancellation flow calls" —
  that flow does not exist yet. Until it does, this script is the process.
- **Venue-side accounting.** A refund issued in credit does not claw back the
  venue's 95% of a settled booking. For a venue-caused cancellation the venue,
  not AIR/Rally, should bear that cost, and there is currently no mechanism for
  it. Track it manually against `booking_settlements` until there is one. See
  `SETTLEMENT-LEDGER.md`.

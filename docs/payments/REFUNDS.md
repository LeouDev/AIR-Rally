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

## The amount: the court price only

**Refund `price_amount`. Never include `processing_fee_amount`.**

```
Court booking price          ₱500.00
Payment processing fee        ₱25.00
Total charged to customer    ₱525.00
Refund credit issued         ₱500.00   <- court price only
```

`calculateRefundCredit()` in `src/lib/services/bookingFee.ts` is the single
source of that number and the refund script uses it. Do not compute it by hand,
and do not reach for `calculateAmountPaid()` — that is the *receipt* figure,
a factual statement of what was charged, and the two must never be conflated.

### Why the fee is not refunded

PayMongo consumed the processing fee at the moment the payment was processed.
AIR/Rally never held it and cannot return it. Refunding it as credit would mean
paying that fee twice out of the 5% commission — once when the booking was made,
and again as credit — which is the leak the pass-through was built to close.

### Why this does not shortchange the customer

**Credit does not attract a processing fee when it is spent.** Checkout grosses
up the *post-credit* amount, so the fee is only ever charged on what PayMongo
actually collects. A ₱500 refund therefore covers a ₱500 court in full: a fully
credit-covered booking creates no PayMongo checkout session at all, so there is
no second fee.

Be precise about what that does and does not mean. The customer paid ₱525 and
can rebook ₱500 of court, so they do bear the original ₱25. That fee is a real
cost of the cancelled transaction, and this rule places it with the customer
rather than with AIR/Rally. It is a deliberate business decision, not an
oversight — recorded here and in `calculateRefundCredit()` so nobody "corrects"
it later.

### The four figures, kept separate

`describeBookingAmounts()` exposes all of them, so no caller re-derives one
slightly differently:

| Figure | Meaning |
|---|---|
| `courtPrice` | what the venue is owed against — **the refundable base** |
| `processingFee` | PayMongo's cut, passed to the customer — **never refunded** |
| `creditApplied` | settled from the wallet, so never sent to PayMongo |
| `payableToProvider` | `price - credit + fee` — what PayMongo was asked to collect |
| `totalPaid` | `price + fee` — the receipt figure |

`payableToProvider` is what `confirm_paymongo_booking_payment()` checks a real
payment against, so it must stay exactly that expression — see migration
`20260810000054`.

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

It prints the booking's figures separated — court price, fee, credit, total
paid — the policy decision, and what it would issue. The refundable base it
quotes is the court price, with the fee shown but explicitly excluded. Re-run
with `--confirm` to issue.

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

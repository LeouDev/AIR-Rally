# Deploying AIR/Rally

**Nothing is deployed yet.** This is the guide for doing it, and the order matters.

---

## Deploy against STAGING first

Not production. Two reasons, and the second is the blocking one:

1. Staging already holds every migration and the demo data, so the site will actually
   have something on it.
2. **Production is missing migrations `20260810000029` through `20260810000046`** —
   everything from Phase 7.8 onward: clubs, events, credits, settlements, payout batches,
   venue payment accounts, transfers, event invites, notification links. A build pointed
   at production would 500 on the first page that touches any of them.

Point the domain at staging, confirm it works, then treat the production migration run as
its own exercise.

---

## 1. Push the repo

```bash
git push origin main
```

Nothing has been pushed for the whole of Phases 8–11 plus the Open Play work.

## 2. Create the project

Vercel is the path of least resistance for Next.js — import the GitHub repo, and it
detects the framework, build command, and output on its own. No `vercel.json` is needed;
the app has no custom routing, no edge functions, and no non-standard build.

## 3. Environment variables

Set these in the host's dashboard. **Never commit them.**

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | staging project URL | from `.env.staging` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | staging publishable key | |
| `SUPABASE_SECRET_KEY` | staging service-role key | **server-only — never `NEXT_PUBLIC_`** |
| `NEXT_PUBLIC_SITE_URL` | `https://air-rally.com` | |
| `PAYMONGO_SECRET_KEY` | `sk_test_…` | **keep it a TEST key** |
| `PAYMONGO_WEBHOOK_SECRET` | webhook signing secret | |

Deliberately **not** set — every one defaults to off, and each is off for a verified
reason:

| Variable | Why it stays unset |
| --- | --- |
| `PAYMONGO_MARKETPLACE_SPLIT_ENABLED` | No venue has an activated PayMongo account |
| `PAYMONGO_REFUND_EXECUTION_ENABLED` | QR Ph payments cannot be refunded via PayMongo's API |
| `PAYMONGO_TRANSFERS_ENABLED` | No PayMongo wallet exists to transfer from |
| `PAYMONGO_PLATFORM_ACCOUNT_ID` | Only needed once splitting is on |

`ACTIVE_PAYMENT_PROVIDER` and `STRIPE_SECRET_KEY` are **obsolete** — Stripe was removed,
and the last code that read the provider variable was deleted along with this guide's
first draft. Don't set either.

## 4. Supabase auth redirect URLs

In the Supabase dashboard → Authentication → URL Configuration, add:

- Site URL: `https://air-rally.com`
- Redirect URLs: `https://air-rally.com/**`

Without this, email confirmation and password reset links point at localhost and silently
fail for every real user.

## 5. PayMongo webhook

Point the PayMongo webhook at `https://air-rally.com/api/paymongo/webhook` and set
`PAYMONGO_WEBHOOK_SECRET` to the signing secret it gives you.

The endpoint verifies the signature against the raw request body before parsing anything —
an unsigned or mismatched request is rejected with a 400 and never reaches a booking.

## 6. Email notifications

Every in-app notification is also emailed, via a **Supabase Database Webhook** —
configured here in the Supabase dashboard, not by a migration, same posture as the
PayMongo webhook above.

1. In [resend.com](https://resend.com), verify `air-rally.com` as a sending domain and
   generate an API key.
2. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (an address at the verified domain, e.g.
   `AIR/Rally <notifications@air-rally.com>`).
3. Generate a random secret (`openssl rand -hex 32`) and set it as
   `SUPABASE_DB_WEBHOOK_SECRET`.
4. In the Supabase dashboard → Database → Webhooks, create a webhook:
   - Table: `notifications`
   - Events: `INSERT`
   - Type: HTTP Request → `https://air-rally.com/api/webhooks/notification-created`
   - HTTP Headers: add `x-webhook-secret` set to the **same value** as
     `SUPABASE_DB_WEBHOOK_SECRET` above — this header is the endpoint's entire
     authority, so a mismatched or missing value here means every email silently fails
     (a 401, logged, never a broken notification — see the route's own comment).

One generic template covers every notification type today (title + message + a link
back into the app) — there's no per-type email design yet, and none of this affects
whether a notification appears in-app, which happens regardless of whether the email
send succeeds.

## 7. Attach the domain

Add `air-rally.com` in the host's domain settings and follow its DNS instructions.

## 8. Smoke test, signed in

The things I cannot verify without a session, in the order they'd hurt most:

- Sign up → confirm email → land signed in
- Explore → court detail → book → PayMongo QR Ph → confirmation page
- `/events/new` → create a game → invite a player → they see the notification and can join
- Post to COURT/Side, like, comment
- Owner: create a venue → admin approves → it appears in Explore
- `/admin/finance` and `/admin/settlements` load with real figures

---

## Going to production later

When production is genuinely the target, in this order:

1. **Apply migrations 029–046** in filename order. Never skip; several depend on earlier
   ones (settlements need bookings' credit columns; payouts need settlements; transfers
   need payout batches).
2. **Take a backup first.** Several migrations alter `bookings` and rewrite trigger
   functions.
3. **Re-run the verification scripts** against production — `verify-staging-*` are gated by
   `assert-staging-env.ts` and will refuse, deliberately. Adapting them is a conscious act,
   not a flag flip.
4. **Swap the env vars** to production Supabase and, only when you genuinely intend to take
   real money, a live PayMongo key.
5. **Re-check the launch gates.** They are off for reasons that have not changed.

---

## What deploying does not fix

- **Venue payouts.** No venue can receive money; there's no PayMongo wallet and no
  activated child merchant. Venues are paid by manual bank transfer, recorded in the
  settlement ledger.
- **Email.** There is no transactional email beyond Supabase's own auth mails. Notifications
  are in-app only.
- **Trust & safety.** No reports table, no `/support`, no rate limiting. Worth closing
  before the app is public, not after.

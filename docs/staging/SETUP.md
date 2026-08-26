# Setting up a staging deployment

Written 2026-08-26. Staging has a database but **no deployed web app**, which
is why test data ended up on production: there was nowhere else to exercise a
real flow. This is the checklist for closing that.

Three of these steps are the founder's — a Vercel project and a Vault secret
are not things the engineering session can create.

---

## Order matters

```
1. Create the Vercel project          (founder)
2. Point app_config.site_url at it    (backend, one row)
3. Add the webhook secret to Vault    (founder)
4. Install pg_net on staging          (backend, LAST — see why below)
```

**`pg_net` goes last, deliberately.** Staging currently *cannot* make outbound
HTTP calls at all, because the extension isn't installed. That is the physical
barrier which, all through 2026-08-26, was the only thing stopping staging's
production-pointed webhooks from actually firing. Install it before the rest is
correct and you remove the barrier before the thing behind it is safe.

---

## Vercel environment variables

### ⚠️ Three that are dangerous to copy from production

These are the whole class of problem staging exists to avoid. A production
value here means staging acts on production's money and production's data.

| Variable | Must be | If you copy production's |
|---|---|---|
| `PAYMONGO_SECRET_KEY` | PayMongo **test** key (`sk_test_…`) | Staging takes **real payments** and moves real money |
| `SUPABASE_SECRET_KEY` | **Staging's** service-role key | A staging site gets full RLS-bypassing access to the **live** database |
| `NEXT_PUBLIC_SUPABASE_URL` | **Staging's** project URL | Staging emails **real users** — this variable is what engages the email redirect |

### Required

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | staging project URL ⚠️ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging → Supabase → API → anon/public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same page |
| `SUPABASE_SECRET_KEY` | same page → service_role ⚠️ |
| `NEXT_PUBLIC_SITE_URL` | the URL Vercel assigns this deployment |
| `RESEND_API_KEY` | may match production |
| `RESEND_FROM_EMAIL` | may match production |
| `EMAIL_REDIRECT_TO` | **the founder's own address** — see below |
| `PAYMONGO_SECRET_KEY` | PayMongo **test** key ⚠️ |
| `PAYMONGO_WEBHOOK_SECRET` | from PayMongo's **test** webhook endpoint |
| `PAYMONGO_PLATFORM_ACCOUNT_ID` | staging/test account id |
| `SUPABASE_DB_WEBHOOK_SECRET` | must **match** the Vault secret added in step 3 |

### Optional — leave unset unless testing that path

`PAYMONGO_TRANSFERS_ENABLED`, `PAYMONGO_REFUND_EXECUTION_ENABLED`,
`PAYMONGO_MARKETPLACE_SPLIT_ENABLED`, `PAYMONGO_PASS_ON_FEES_ENABLED`

### Not needed on Vercel

`DATABASE_URL`, `VERCEL_API_TOKEN`, `BOOKING_TEST_EMAIL`,
`BOOKING_TEST_PASSWORD` — local and CI only. `DATABASE_URL` is a direct
Postgres connection string and does not belong in a web deployment.

---

## `EMAIL_REDIRECT_TO` is not optional in practice

Off production, **every** recipient is replaced by this address, and the
intended recipient is carried in the subject:

```
[staging → someone@example.com] Your payout
```

**Without it, staging sends no email at all** — silently, by design. Staging
carries accounts with real-looking addresses, and an unconfigured staging
mailing them is worse than one mailing nobody. If mail never arrives, check
this first.

---

## How to know it worked

Each step isolates a different layer.

1. **The homepage shows staging's venues, not production's.** Staging has 7;
   production has 3. **If you see 3, `NEXT_PUBLIC_SUPABASE_URL` is wrong** —
   that is the dangerous misconfiguration and this catches it immediately.
2. **Sign in with a staging account.** A production account will *not* work.
   That is the confirmation, not a fault.
3. **Trigger something that emails.** A message should arrive at your own
   address with a subject starting `[staging → …]`. **If mail arrives WITHOUT
   that prefix, the deployment believes it is production — stop and re-check
   `NEXT_PUBLIC_SUPABASE_URL`.**
4. **Nothing arrives at all** → `EMAIL_REDIRECT_TO` is unset. One variable.

Steps 1 and 3 check the same thing from opposite directions, and both fail
loudly if staging is pointed at production — the failure worth catching.

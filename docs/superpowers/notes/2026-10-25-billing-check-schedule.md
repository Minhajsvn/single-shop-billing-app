# Daily billing check: owner setup steps

The admin console has a daily billing check. It compares every shop's billing record with Stripe and
flags anything that disagrees on the admin shop list ("Needs a look"). It never changes a subscription.

The app only provides the endpoint. Running it once a day is set up on the host, by you.

## 1. Set two server variables on the host

Set these in the hosting dashboard (for example Vercel → Project → Settings → Environment Variables,
Production only). Never put them in the code or in a `NEXT_PUBLIC_` variable.

| Variable | Value |
| --- | --- |
| `PLATFORM_STAFF_EMAILS` | Your staff sign-in email(s), comma-separated, e.g. `you@yourcompany.example`. The account must have a confirmed email. |
| `ADMIN_CRON_SECRET` | A long random secret, **at least 32 characters**. A shorter or missing secret turns the scheduled call off. |

**Protect the staff check before you list anyone.** The app treats a user as staff when their email is on
`PLATFORM_STAFF_EMAILS` and confirmed, so it relies on the hosted Supabase project confirming emails:

1. Keep **Confirm email** turned on in the hosted Supabase project (Authentication → Sign In / Providers → Email).
   With it off, anyone who signs up with an allowlisted address is staff at once.
2. Register (and confirm) the staff account first, then add its email to `PLATFORM_STAFF_EMAILS`. Never list an
   address that has no account yet, or someone could sign up with it.

Details: `docs/superpowers/notes/2026-10-21-hosted-auth-setup.md`, section 7.

Make a secret on your own computer, for example:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Redeploy after changing variables.

## 2. Schedule one POST a day

The scheduler sends:

```
POST https://<your-app-domain>/api/v1/admin/billing-check
x-admin-cron-secret: <ADMIN_CRON_SECRET>
```

No body is needed (it checks every shop with a Stripe subscription). Answers:

- `200 {"checked": N, "mismatches": M, "failed": F}`: done. `failed` counts shops Stripe could not answer for.
- `200 {"error": "Billing is not set up yet."}`: Stripe is not configured on this host; nothing was done.
- `404 {"error": "Not found"}`: the secret header is missing or wrong (or `ADMIN_CRON_SECRET` is shorter than 32
  characters, or missing). This is the same answer as a page that does not exist, so nobody without the secret can
  tell the endpoint is there. A misconfigured scheduler just sees a non-2xx answer: if every run fails with 404,
  check the URL, the header name and the secret value on both sides.

Pick **one** of the options below.

### Option A: hosting on Vercel

Vercel Cron (`vercel.json` → `crons`) only sends a `GET` with `Authorization: Bearer <CRON_SECRET>`. It
cannot send a `POST` or our header, so pointing it at this route gets `404`. On Vercel, use option B or a
scheduler that can send a `POST` with a custom header (for example GitHub Actions or cron-job.org), with
these settings:

- Method `POST`, URL `https://<your-app-domain>/api/v1/admin/billing-check`
- Header `x-admin-cron-secret` = the value of `ADMIN_CRON_SECRET`
- Once a day, for example 03:00 Dubai time (23:00 UTC)

GitHub Actions example (`.github/workflows/billing-check.yml` in a private repository; store the secret
under Settings → Secrets → Actions as `ADMIN_CRON_SECRET`):

```yaml
name: Daily billing check
on:
  schedule:
    - cron: "0 23 * * *"
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl --fail -sS -X POST "https://<your-app-domain>/api/v1/admin/billing-check" \
            -H "x-admin-cron-secret: ${{ secrets.ADMIN_CRON_SECRET }}"
```

### Option B: Supabase scheduled call (pg_cron + pg_net)

In the hosted Supabase dashboard (not the local one):

1. Database → Extensions: enable `pg_cron` and `pg_net`.
2. Project Settings → Vault: add a secret named `admin_cron_secret` with the `ADMIN_CRON_SECRET` value.
3. SQL editor, replacing `<your-app-domain>`:

```sql
select cron.schedule(
  'daily-billing-check',
  '0 23 * * *',
  $$
  select net.http_post(
    url := 'https://<your-app-domain>/api/v1/admin/billing-check',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-admin-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'admin_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

To stop it: `select cron.unschedule('daily-billing-check');`

## 3. Check it works

- Sign in with a staff email and open `/admin/shops/<a shop with a Stripe subscription>`.
  "Billing check → Last checked" shows the time of the last run.
- Or press "Run billing check now" on that page.

## What a flag means

A flag says our record and Stripe disagree on one thing: status, current period end, cancel date, trial
end, or whether the Stripe subscription still exists. Times within one hour count as agreeing. Fix the
cause in Stripe (or wait for a late webhook), then press "Mark looked at" with a note. If the next check
still disagrees, a new flag opens.

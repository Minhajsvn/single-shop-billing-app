# Hosted Supabase: sign-up, email links and adding a cashier

These are one-time steps for the hosted Supabase project, done by the owner in the Supabase dashboard.
Local development already has all of this in `supabase/config.toml`; nothing here is needed for local work.

Replace `https://YOUR-APP-ADDRESS` below with the address people open the app at (for example `https://shop.example.com`), with no slash at the end.

## 0. Apply this release's database changes first

Before this release goes live, the hosted database must have every migration in `supabase/migrations`, applied in
file-name order. Check which are already applied (Supabase dashboard → **Database → Migrations**, or
`supabase migration list` against the hosted project) and apply the missing ones before the new app version is
deployed. The ones from this release, and from Stage 1F (billing) in case they are not applied yet:

- Stage 1F: `202610190023_billing_lifecycle.sql`, `202610190024_register_access_gate.sql`,
  `202610190025_members_read_devices.sql`, `202610200026_entitlements_period_end.sql`,
  `202610200027_canceled_is_final.sql`, `202610200028_paused_at_server_stamped.sql`
- Stage 1G (this release): `202610210029_cashier_access.sql`, `202610210030_till_status_guard.sql`,
  `202610210031_onboarding_status.sql`, `202610220032_refund_lock_invoice_case.sql`

Take a backup of the hosted database before applying them.

**Refunds made before this release.** Until `202610210029_cashier_access.sql`, the server's refund sync had a bug:
every refund with returned items was rejected, so it never reached the server. Refunds made on a hosted shop before
this release exist only on the till that made them (in that till's browser storage); they are not in the server's
reports, and other tills and the owner's dashboard do not see them. That till keeps them as failed sync operations and
tries them again on its next sync, so some may arrive once the migrations are applied, but only while that browser's
storage still holds them and the server accepts them (for example, the till must have an open shift). Do not count on
it: check each shop's refunds on its tills after the release.

## 1. Turn on email confirmation

1. Open the project in the Supabase dashboard.
2. Go to **Authentication → Sign In / Providers → Email**.
3. Make sure **Enable Email provider** is on.
4. Turn on **Confirm email**.
5. Set **Minimum password length** to `8`.
6. Click **Save**.

## 2. Set the app address (URL configuration)

1. Go to **Authentication → URL Configuration**.
2. In **Site URL**, enter `https://YOUR-APP-ADDRESS` and click **Save**.
   The email links are built from this address, so it must be exactly where the app runs.
3. Under **Redirect URLs**, click **Add URL**, enter `https://YOUR-APP-ADDRESS/**` and save.

## 3. Send email through your own mail service (SMTP)

Supabase's built-in mail only sends a few emails an hour and only to team members, so real shop owners will not get their links without this step.

1. Get SMTP details from your mail provider (for example Resend, Postmark, SendGrid, Amazon SES or Zoho): host, port, user name, password, and a sender address on a domain you own.
2. Go to **Authentication → Emails → SMTP Settings** and turn on **Enable custom SMTP**.
3. Fill in **Sender email** (for example `no-reply@your-domain`), **Sender name** (`Shop Ledger`), **Host**, **Port**, **Username** and **Password**.
4. Click **Save**.
5. Go to **Authentication → Rate Limits** and raise **Rate limit for sending emails** to a number that fits your expected sign-ups per hour (for example 30).

## 4. Paste the two email templates

The app's links verify a one-time token on the server, so they work even when the email is opened on another device (for example a phone). The default Supabase templates do not do this, so replace them.

1. Go to **Authentication → Emails → Templates**.
2. Choose **Confirm signup**.
   - **Subject:** `Confirm your email for Shop Ledger`
   - **Body:** delete everything, then paste the whole of `supabase/templates/confirmation.html` from this repository.
   - Click **Save**.
3. Choose **Reset Password**.
   - **Subject:** `Reset your Shop Ledger password`
   - **Body:** delete everything, then paste the whole of `supabase/templates/recovery.html`.
   - Click **Save**.

Leave `{{ .SiteURL }}` and `{{ .TokenHash }}` exactly as written; Supabase fills them in.

## 5. Check it works

1. Open `https://YOUR-APP-ADDRESS/signup` in a private window and sign up with an email you can read.
2. You should see "Check your email". Open the email and click **Confirm my email**.
3. You should land on "Set up your shop".
4. Sign out, click **Forgot password?** on the sign-in page, and check the reset email brings you to "Choose a new password".

If a link says "This link has expired or was already used", check that the Site URL in step 2 matches the app address exactly.

## 6. Add a cashier to a shop

There is no invite screen yet. The owner creates the cashier's account; the cashier does **not** sign up.

> **Warning:** do not let a cashier sign up at `/signup` and fill in "Set up your shop". That makes them the owner of a
> trial shop of their own. Someone who belongs to two shops always works in the one where they have the highest role,
> so after being added to your shop as a cashier they would still sell into their own trial shop. If a cashier already
> did this, create a new account for them with a different email address and add that one instead.

1. In the Supabase dashboard, go to **Authentication → Users → Add user → Create new user**.
2. Enter the cashier's email address and a starting password (8 characters or more), tick **Auto Confirm User**, and click **Create user**.
   Give the password to the cashier in person. They can change it later with **Forgot password?** on the sign-in page.
3. Open **SQL Editor → New query**.
4. Paste this line, replace the two email addresses, and click **Run**:

```sql
insert into public.business_members (business_id, user_id, role, status) select b.id, u.id, 'cashier', 'active' from public.businesses b, auth.users u where u.email = '<cashier email>' and b.owner_id = (select id from auth.users where email = '<owner email>');
```

5. It should say `1 row` was inserted. `0 rows` means one of the email addresses is wrong, or the cashier's account was not created in step 2.
6. The cashier signs in at `https://YOUR-APP-ADDRESS/login` with that email and password and goes straight to the till.

Notes on this line (checked against `supabase/migrations/202610110010_members_branches.sql` and `202608300001_sprint_one_foundation.sql`):
- `business_members` has the columns `business_id`, `user_id`, `role` (`cashier`, `manager` or `owner`) and `status` (`active` or `disabled`); `businesses.owner_id` is the owner's user id.
- Each person can be added to a shop once; running it twice for the same cashier gives a "duplicate key" error, which is harmless.
- The shop's plan limits how many members it can have. If the shop is at its limit, the insert is refused with a plan-limit error.
- To remove a cashier later, set their status to `disabled` instead of deleting the row.

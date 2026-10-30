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
- Stage 1G: `202610210029_cashier_access.sql`, `202610210030_till_status_guard.sql`,
  `202610210031_onboarding_status.sql`, `202610220032_refund_lock_invoice_case.sql`,
  `202610220033_pause_resume_till.sql`, `202610220034_paused_shift_age.sql`
- Stage 1H (admin console): `202610250035_admin_console.sql`, `202610250036_billing_flags.sql`,
  `202610250037_trial_end_from_stripe.sql`, `202610250038_owner_audit_hides_admin.sql`,
  `202610250039_choose_active_tills.sql`
- Stage 1I (admin grants and members): `202610290040_plan_grants.sql`, `202610290041_admin_members.sql`

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

## 4. Paste the three email templates

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
4. Choose **Invite user**.
   - **Subject:** `You're invited to Shop Ledger`
   - **Body:** delete everything, then paste the whole of `supabase/templates/invite.html`.
   - Click **Save**.

Leave `{{ .SiteURL }}` and `{{ .TokenHash }}` exactly as written; Supabase fills them in.

## 5. Check it works

1. Open `https://YOUR-APP-ADDRESS/signup` in a private window and sign up with an email you can read.
2. You should see "Check your email". Open the email and click **Confirm my email**.
3. You should land on "Set up your shop".
4. Sign out, click **Forgot password?** on the sign-in page, and check the reset email brings you to "Choose a new password".

If a link says "This link has expired or was already used", check that the Site URL in step 2 matches the app address exactly.

## 6. Add a cashier to a shop

Add cashiers from the admin console. Only platform staff can open it (see step 7), so the owner asks staff to add the person.
The cashier does **not** sign up.

> **Warning:** do not let a cashier sign up at `/signup` and fill in "Set up your shop". That makes them the owner of a
> trial shop of their own. Someone who belongs to two shops always works in the one where they have the highest role,
> so after being added to your shop as a cashier they would still sell into their own trial shop. If a cashier already
> did this, add a different email address for them instead.

1. Open `https://YOUR-APP-ADDRESS/admin`, find the shop and open it.
2. Go to **Members** and click **Add user**. Enter the cashier's email address and choose the role (cashier or manager).
3. The cashier gets an invite email with a link to set a password. Do not give them a password yourself.
4. The cashier signs in at `https://YOUR-APP-ADDRESS/login` with that email and the password they chose, and goes straight to the till.

Notes:
- Adding a user is refused when the shop is at its plan's member limit. Free a seat or change the plan first.
- To remove a cashier later, use **Disable** on the Members table instead of deleting the person. **Enable** puts them back.

## 7. Platform staff (admin console)

The admin console (`/admin`) is open only to signed-in users whose email is on the `PLATFORM_STAFF_EMAILS` server
variable **and** is confirmed. The app trusts Supabase to have confirmed the address, so the order of these steps
matters:

1. Keep **Confirm email** turned on in the hosted project (step 1 above). If it is off, every new sign-up counts as
   confirmed straight away, and anyone who signs up with an allowlisted address becomes staff.
2. Register the staff account first: sign up at `https://YOUR-APP-ADDRESS/signup` with the staff email and click
   the confirmation link (or create it under **Authentication → Users → Add user → Create new user** with
   **Auto Confirm User**, if you own that mailbox). Do not fill in "Set up your shop" with it.
3. Only then add that email to `PLATFORM_STAFF_EMAILS` on the host and redeploy.

Never list an email that has no account yet: until it is registered, anyone can sign up with that address, and only
the confirmation email stands between them and the admin console. To remove someone from staff, take their email off `PLATFORM_STAFF_EMAILS` and
redeploy.

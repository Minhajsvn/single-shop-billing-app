# Hosted Supabase: sign-up, email links and adding a cashier

These are one-time steps for the hosted Supabase project, done by the owner in the Supabase dashboard.
Local development already has all of this in `supabase/config.toml`; nothing here is needed for local work.

Replace `https://YOUR-APP-ADDRESS` below with the address people open the app at (for example `https://shop.example.com`), with no slash at the end.

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

There is no invite screen yet. To give a cashier access:

1. Ask the cashier to sign up at `https://YOUR-APP-ADDRESS/signup` and confirm their email. (They will see "Set up your shop" afterwards; they should not fill it in.)
2. In the Supabase dashboard, open **SQL Editor → New query**.
3. Paste this line, replace the two email addresses, and click **Run**:

```sql
insert into public.business_members (business_id, user_id, role, status) select b.id, u.id, 'cashier', 'active' from public.businesses b, auth.users u where u.email = '<cashier email>' and b.owner_id = (select id from auth.users where email = '<owner email>');
```

4. It should say `1 row` was inserted. `0 rows` means one of the email addresses is wrong, or the cashier has not signed up yet.

Notes on this line (checked against `supabase/migrations/202610110010_members_branches.sql` and `202608300001_sprint_one_foundation.sql`):
- `business_members` has the columns `business_id`, `user_id`, `role` (`cashier`, `manager` or `owner`) and `status` (`active` or `disabled`); `businesses.owner_id` is the owner's user id.
- Each person can be added to a shop once; running it twice for the same cashier gives a "duplicate key" error, which is harmless.
- The shop's plan limits how many members it can have. If the shop is at its limit, the insert is refused with a plan-limit error.
- To remove a cashier later, set their status to `disabled` instead of deleting the row.

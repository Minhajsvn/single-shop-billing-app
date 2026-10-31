# Razorpay billing: owner setup steps

Billing now runs on Razorpay (Stripe is gone). These steps are done by you, in the Razorpay dashboard and the
Vercel dashboard. Nothing here is needed for local work: locally the app uses a pretend provider.

Do the steps in order. Billing shows "Billing is not set up yet." until every step is done.

## 1. Ask Razorpay to switch on two things

Your Razorpay account is registered in India, but your customers are in the UAE and pay in AED. Payouts reach you in INR.
Ask Razorpay support (or use the dashboard request for each) to enable:

- **International payments**, so cards from outside India work and AED can be charged.
- **Subscriptions**, so cards are charged again automatically each month or year.

Razorpay may ask for documents and may take a few days. Do this first.

## 2. Create the two plans (in AED, no VAT)

In the Razorpay dashboard go to **Subscriptions → Plans → Create Plan** and make two plans:

| Plan | Currency | Amount | Billing period |
| --- | --- | --- | --- |
| Starter monthly | AED | 99 | every 1 month |
| Starter yearly | AED | 990 | every 1 year |

The amounts are charged as they are. The app adds no VAT line. After saving each plan, copy its **plan id** (it
starts with `plan_`). You need both ids in step 4.

Two limits to confirm in Razorpay **test mode** before going live (the app assumes them):

- A subscription runs for 120 charges on the monthly plan and 10 charges on the yearly plan (10 years each).
- A trial that still has more than 24 hours left delays the first charge until the trial ends. The app asks
  Razorpay to start charging on the trial end date. Check that Razorpay accepts this start date.

If test mode rejects either, tell the developer before going live.

## 3. Add the webhook

The webhook is how Razorpay tells the app that a card was saved, a payment went through, a payment failed or a
subscription ended.

1. In Razorpay go to **Account & Settings → Webhooks → Add New Webhook**.
2. Webhook URL: `https://<your-app-domain>/api/v1/billing/webhook`
3. Secret: make a long random secret and keep a copy. This is `RAZORPAY_WEBHOOK_SECRET`. For example:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Tick these events:
   - `subscription.authenticated`
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.pending`
   - `subscription.halted`
   - `subscription.cancelled`
   - `subscription.completed`
   - `subscription.expired` (only if Razorpay offers it)
5. Save. Razorpay signs each call (header `x-razorpay-signature`) and numbers each event (header
   `x-razorpay-event-id`). The app rejects any call with a wrong signature and ignores an event it has already seen.

Razorpay has a separate test mode and live mode, each with its own keys, plans and webhook. Repeat steps 2 and 3
in live mode when you go live.

## 4. Set five variables on Vercel

In Vercel → Project → Settings → Environment Variables, set these for **Production**. Never put them in the code or
in a `NEXT_PUBLIC_` variable.

| Variable | Value |
| --- | --- |
| `RAZORPAY_KEY_ID` | Razorpay dashboard → Account & Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | Shown once when you generate the key |
| `RAZORPAY_WEBHOOK_SECRET` | The secret from step 3 |
| `RAZORPAY_PLAN_STARTER_MONTHLY` | The monthly plan id from step 2 |
| `RAZORPAY_PLAN_STARTER_ANNUAL` | The yearly plan id from step 2 |

Redeploy after changing variables. Remove the old `STRIPE_*` variables.

## 5. Fill in your business details

Open `lib/site-info.ts` and replace the four bracketed placeholders with the real values: legal business name,
registered address, support email and phone. These show on the public pages and Razorpay's reviewers read them.

Billing stays "Billing is not set up yet." until all five variables are set **and** no placeholder is left in
`lib/site-info.ts`. This holds in every environment.

## 6. Do one test-mode run

Before using live keys, set the five variables to your Razorpay **test** keys, test plans and test webhook. Then:

1. Sign up a new shop and open **Billing**.
2. Choose a plan and pay with Razorpay's test card (the test card numbers are listed in Razorpay's docs under
   "Test cards"). Check the Billing tab shows the card saved and the plan.
3. Press **Cancel subscription**. Check it shows "Cancels on <date>".
4. Sign in with the staff account and open `/admin/shops/<that shop>`. Press "Run billing check now". It should
   report no mismatch.

Then switch the variables to live keys, live plans and the live webhook, and redeploy.

## 7. Approval checklist

Razorpay checks that the website shows these items. All pages are public (no sign-in) and have a footer link on
the home, sign-in and sign-up pages. Fill in `lib/site-info.ts` before you submit.

| What Razorpay asks for | Where it is |
| --- | --- |
| Pricing | `/` (home page) |
| Terms and conditions | `/terms` |
| Privacy policy | `/privacy` |
| Refund and cancellation policy | `/refunds` |
| Contact details (name, address, email, phone) | `/contact` |

Read each page once. The wording was drafted from how the app behaves; you approve it.

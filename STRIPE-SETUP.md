# HoneyWireStudio Stripe Setup

Use this when you are ready to connect real payments.

## 1. Create your `.env` file

Copy `.env.example` and rename the copy to `.env`.

Fill these first:

```bash
STRIPE_SECRET_KEY=sk_test_or_live_your_key_here
PUBLIC_SITE_URL=https://honeywirestudio.netlify.app
OWNER_EMAIL=nramirez1789@gmail.com
OWNER_PHONE=+18055358720
```

Use a `sk_test_...` key while testing. Use `sk_live_...` only when the site is ready to take real payments.

## 2. Add a Stripe webhook

In Stripe Dashboard, add this webhook endpoint:

```text
https://honeywirestudio.netlify.app/api/stripe-webhook
```

Listen for this event:

```text
checkout.session.completed
```

Stripe will give you a webhook signing secret that starts with `whsec_`. Add it to `.env`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
```

## 3. Apple Pay

Stripe Checkout can show Apple Pay automatically when:

- Apple Pay is enabled in Stripe
- the customer is using a supported Apple device/browser
- your live domain is verified in Stripe

## 4. Email and text confirmations

The site is already coded to send owner/customer notifications after payment.

For email, add Resend:

```bash
RESEND_API_KEY=re_your_key_here
FROM_EMAIL=HoneyWireStudio <orders@your-domain.com>
```

For text messages, add Twilio:

```bash
TWILIO_ACCOUNT_SID=AC_your_sid_here
TWILIO_AUTH_TOKEN=your_token_here
TWILIO_FROM_PHONE=+15555555555
```

Without Resend or Twilio keys, the server still works for checkout but logs notifications locally instead of sending them.


## Manual Netlify upload note

If you deploy by dragging a folder/zip into Netlify, upload the whole website folder, including:
- all `.html` files
- `style.css`
- `script.js`
- `package.json`
- `package-lock.json`
- `netlify.toml`
- the `netlify/functions` folder
- your `images` folder

Do not upload your local `.env` file.

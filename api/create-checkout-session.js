import Stripe from "stripe";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: true,
        message: "Stripe function is live. Use POST from the checkout button.",
      });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY in Vercel." });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const order = req.body || {};
    const productName = order.productName || "HoneyWireStudio Order";
    const itemAmount = Math.round(Number(order.itemAmount || 25) * 100);
    const shippingAmount = Math.round(Number(order.shippingAmount || 9.85) * 100);

    const siteUrl =
      process.env.PUBLIC_SITE_URL || "https://honey-wire-studio.vercel.app";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      automatic_payment_methods: { enabled: true },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: productName },
            unit_amount: itemAmount,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Flat rate shipping" },
            unit_amount: shippingAmount,
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/success.html`,
      cancel_url: `${siteUrl}/shop.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
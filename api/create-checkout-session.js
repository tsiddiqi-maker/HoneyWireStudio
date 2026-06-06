import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SHIPPING_AMOUNT = 9.85;

function toCents(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return Math.round(fallback * 100);
  return Math.round(number * 100);
}

function cleanText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 500);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY in Vercel environment variables." });
    }

    const order = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const productName = cleanText(order.productName, "HoneyWireStudio Order");
    const itemAmount = toCents(order.itemAmount, 25);
    const shippingAmount = toCents(order.shippingAmount ?? SHIPPING_AMOUNT, SHIPPING_AMOUNT);
    const siteUrl = (process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`).replace(/\/$/, "");
    const customer = order.customer || {};
    const notes = order.notes || {};

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      automatic_payment_methods: { enabled: true },
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ["US"] },
      customer_email: cleanText(customer.email).toLowerCase() || undefined,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: productName,
              description: cleanText(notes.specialRequests || notes.size || "Handmade HoneyWireStudio piece", "Handmade HoneyWireStudio piece").slice(0, 250)
            },
            unit_amount: itemAmount
          },
          quantity: 1
        },
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Flat rate shipping" },
            unit_amount: shippingAmount
          },
          quantity: 1
        }
      ],
      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/${order.type === "custom" ? "customs.html" : "shop.html"}`,
      metadata: {
        type: cleanText(order.type, "product").slice(0, 40),
        product: productName.slice(0, 500),
        item_total: `$${(itemAmount / 100).toFixed(2)}`,
        shipping: `$${(shippingAmount / 100).toFixed(2)}`,
        total: `$${((itemAmount + shippingAmount) / 100).toFixed(2)}`,
        customer_name: cleanText(`${customer.firstName || ""} ${customer.lastName || ""}`.trim()).slice(0, 120),
        customer_email: cleanText(customer.email).slice(0, 200),
        customer_phone: cleanText(customer.phone).slice(0, 40),
        address: cleanText(`${customer.address || ""} ${customer.city || ""} ${customer.state || ""} ${customer.zip || ""}`.trim()).slice(0, 450),
        notes: cleanText(Object.entries(notes).map(([key, val]) => `${key}: ${val}`).join(" | ")).slice(0, 500)
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return res.status(500).json({ error: error.message || "Stripe checkout failed." });
  }
}

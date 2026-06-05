import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const siteUrl = process.env.PUBLIC_SITE_URL || "https://honeywirestudio.netlify.app";
const shippingDefault = 9.85;

function moneyToCents(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) return Math.round(fallback * 100);
  return Math.round(number * 100);
}

function clean(value, max = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("Missing STRIPE_SECRET_KEY in Netlify environment variables.");
    }

    const order = JSON.parse(event.body || "{}");

    const productName = clean(order.productName || "HoneyWireStudio Order", 120);
    const itemAmount = moneyToCents(order.itemAmount || order.price || 25, 25);
    const shippingAmount = moneyToCents(order.shippingAmount ?? shippingDefault, shippingDefault);
    const customer = order.customer || {};
    const notes = order.notes || {};

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      automatic_payment_methods: { enabled: true },
      customer_email: clean(customer.email, 200) || undefined,
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: itemAmount,
            product_data: {
              name: productName,
            },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: shippingAmount,
            product_data: {
              name: "Flat Rate Shipping",
            },
          },
        },
      ],
      metadata: {
        type: clean(order.type || "product", 40),
        productName,
        itemAmount: `$${(itemAmount / 100).toFixed(2)}`,
        shippingAmount: `$${(shippingAmount / 100).toFixed(2)}`,
        customerName: clean(`${customer.firstName || ""} ${customer.lastName || ""}`, 120),
        customerEmail: clean(customer.email, 200),
        customerPhone: clean(customer.phone, 40),
        address: clean(`${customer.address || ""}, ${customer.city || ""}, ${customer.state || ""} ${customer.zip || ""}`, 450),
        size: clean(notes.size || "None", 120),
        specialRequests: clean(notes.specialRequests || "None", 450),
      },
      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/shop.html`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Checkout could not start." }),
    };
  }
}

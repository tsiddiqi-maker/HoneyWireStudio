require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async function () {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Custom Nail Set",
            },
            unit_amount: 2500, // $25.00
          },
          quantity: 1,
        },
      ],
      success_url: "https://honeywirestudio.netlify.app/success.html",
      cancel_url: "https://honeywirestudio.netlify.app/cancel.html",
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        url: session.url,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
      }),
    };
  }
};
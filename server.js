import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const root = resolve('.');
const port = Number(process.env.PORT || 3000);
const shippingDefault = 9.85;

loadLocalEnv();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/create-checkout-session') {
      const body = await readJson(req);
      return sendJson(res, 200, await createCheckoutSession(body, req));
    }

    if (req.method === 'POST' && url.pathname === '/api/contact') {
      const body = await readJson(req);
      await notifyOwner('New HoneyWireStudio message', contactMessage(body));
      if (body.email) await sendEmail(body.email, 'HoneyWireStudio received your message', customerContactMessage(body));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/stripe-webhook') {
      const rawBody = await readRaw(req);
      const event = verifyStripeWebhook(rawBody, req.headers['stripe-signature']);
      if (event?.type === 'checkout.session.completed') await handleCompletedCheckout(event.data.object);
      return sendJson(res, 200, { received: true });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    return serveStatic(url.pathname, res, req.method === 'HEAD');
  } catch (error) {
    const status = error.status || 500;
    if (req.url?.startsWith('/api/')) return sendJson(res, status, { error: error.message || 'Server error' });
    return sendText(res, status, error.message || 'Server error');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`HoneyWireStudio running at http://localhost:${port}`);
});

async function createCheckoutSession(order, req) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw httpError(501, 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to the server environment.');
  }

  const itemAmount = moneyToCents(order.itemAmount);
  const shippingAmount = moneyToCents(order.shippingAmount ?? shippingDefault);
  const total = ((itemAmount + shippingAmount) / 100).toFixed(2);
  const customer = order.customer || {};
  const origin = process.env.PUBLIC_SITE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const productName = clean(order.productName || 'HoneyWireStudio Order', 120);
  const notes = order.notes || {};

  const params = new URLSearchParams({
    mode: 'payment',
    success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/${order.type === 'custom' ? 'customs.html' : 'shop.html'}`,
    customer_email: clean(customer.email || '', 200),
    'automatic_payment_methods[enabled]': 'true',
    'phone_number_collection[enabled]': 'true',
    'shipping_address_collection[allowed_countries][0]': 'US',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(itemAmount),
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[1][quantity]': '1',
    'line_items[1][price_data][currency]': 'usd',
    'line_items[1][price_data][unit_amount]': String(shippingAmount),
    'line_items[1][price_data][product_data][name]': 'Flat rate shipping',
    'metadata[type]': clean(order.type || 'product', 40),
    'metadata[product]': productName,
    'metadata[item_total]': `$${(itemAmount / 100).toFixed(2)}`,
    'metadata[shipping]': `$${(shippingAmount / 100).toFixed(2)}`,
    'metadata[total]': `$${total}`,
    'metadata[name]': clean(`${customer.firstName || ''} ${customer.lastName || ''}`.trim(), 120),
    'metadata[email]': clean(customer.email || '', 200),
    'metadata[phone]': clean(customer.phone || '', 40),
    'metadata[address]': clean(formatAddress(customer), 450),
    'metadata[notes]': clean(formatNotes(notes), 450)
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  const data = await response.json();
  if (!response.ok) throw httpError(response.status, data.error?.message || 'Stripe checkout failed.');
  return { url: data.url };
}

async function handleCompletedCheckout(session) {
  const meta = session.metadata || {};
  const customerEmail = meta.email || session.customer_details?.email;
  const customerPhone = meta.phone || session.customer_details?.phone;
  const ownerSubject = `Paid HoneyWireStudio order: ${meta.product || 'Order'}`;
  const ownerBody = [
    'A paid order came through HoneyWireStudio.',
    '',
    `Type: ${meta.type || 'Order'}`,
    `Product: ${meta.product || 'Unknown'}`,
    `Item: ${meta.item_total || ''}`,
    `Shipping: ${meta.shipping || ''}`,
    `Total: ${meta.total || dollars(session.amount_total)}`,
    '',
    `Customer: ${meta.name || session.customer_details?.name || 'Not provided'}`,
    `Email: ${customerEmail || 'Not provided'}`,
    `Phone: ${customerPhone || 'Not provided'}`,
    `Address: ${meta.address || 'See Stripe session'}`,
    '',
    `Notes: ${meta.notes || 'None'}`,
    '',
    `Stripe session: ${session.id}`
  ].join('\n');

  await notifyOwner(ownerSubject, ownerBody);

  if (customerEmail) {
    await sendEmail(customerEmail, 'Your HoneyWireStudio order is confirmed', [
      'Thank you for your HoneyWireStudio order.',
      '',
      `Product: ${meta.product || 'Order'}`,
      `Total: ${meta.total || dollars(session.amount_total)}`,
      '',
      'Your piece will be made fresh and HoneyWireStudio will reach out if any details need confirmation.',
      '',
      'Questions? Reply to nramirez1789@gmail.com or text (805) 535-8720.'
    ].join('\n'));
  }

  if (customerPhone) {
    await sendSms(customerPhone, `HoneyWireStudio received your paid order for ${meta.product || 'your piece'}. Thank you!`);
  }
}

async function notifyOwner(subject, body) {
  await sendEmail(process.env.OWNER_EMAIL || 'nramirez1789@gmail.com', subject, body);
  if (process.env.OWNER_PHONE) await sendSms(process.env.OWNER_PHONE, `${subject}\n${body}`.slice(0, 1400));
}

async function sendEmail(to, subject, text) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`Email skipped; RESEND_API_KEY missing.\nTo: ${to}\nSubject: ${subject}\n${text}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || 'HoneyWireStudio <orders@example.com>',
      to,
      subject,
      text
    })
  });

  if (!response.ok) console.error('Resend email failed:', await response.text());
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_PHONE;
  if (!sid || !token || !from) {
    console.log(`SMS skipped; Twilio env missing.\nTo: ${to}\n${body}`);
    return;
  }

  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!response.ok) console.error('Twilio SMS failed:', await response.text());
}

function verifyStripeWebhook(rawBody, signatureHeader) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.log('Stripe webhook received without signature verification because STRIPE_WEBHOOK_SECRET is missing.');
    return JSON.parse(rawBody);
  }

  const pieces = Object.fromEntries(String(signatureHeader || '').split(',').map((part) => part.split('=')));
  if (!pieces.t || !pieces.v1) throw httpError(400, 'Missing Stripe signature.');
  const signedPayload = `${pieces.t}.${rawBody}`;
  const expected = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(signedPayload).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(pieces.v1);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw httpError(400, 'Invalid Stripe signature.');
  }
  return JSON.parse(rawBody);
}

function serveStatic(pathname, res, headOnly) {
  const cleanPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = normalize(join(root, cleanPath));
  if (!filePath.startsWith(root)) return sendText(res, 403, 'Forbidden');
  if (!existsSync(filePath)) return sendText(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream' });
  if (headOnly) return res.end();
  createReadStream(filePath).pipe(res);
}

function contactMessage(body) {
  return [
    'New message from HoneyWireStudio contact form.',
    '',
    `Name: ${body.firstName || ''} ${body.lastName || ''}`,
    `Email: ${body.email || ''}`,
    `Phone: ${body.phone || 'Not provided'}`,
    `Topic: ${body.topic || 'General'}`,
    '',
    body.message || ''
  ].join('\n');
}

function customerContactMessage(body) {
  return [
    `Hi ${body.firstName || 'there'},`,
    '',
    'HoneyWireStudio received your message and will reply soon.',
    '',
    'Thank you,',
    'HoneyWireStudio'
  ].join('\n');
}

function formatAddress(customer) {
  return [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ');
}

function formatNotes(notes) {
  return Object.entries(notes).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(' | ') || 'None';
}

function moneyToCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw httpError(400, 'Invalid checkout amount.');
  return Math.round(number * 100);
}

function dollars(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function clean(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function readJson(req) {
  return readRaw(req).then((raw) => raw ? JSON.parse(raw) : {});
}

function readRaw(req) {
  return new Promise((resolveRead, rejectRead) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolveRead(data));
    req.on('error', rejectRead);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function loadLocalEnv() {
  const path = join(root, '.env');
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

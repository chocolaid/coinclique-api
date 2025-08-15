# Backend Payments API (Paystack + Firestore)

Audience: Another AI/dev building a secure backend for CoinClique. Implement either Next.js (App Router or Pages) or NestJS. Keep all Paystack secrets on the server. The mobile app should never hold secret keys or collect raw PAN data.

## Goals

- One-time card capture → store reusable `authorization_code`
- On-demand top-ups (charge saved card)
- Optional subscriptions (auto-charge at interval)
- Webhook reconciliation to keep Firestore truth in sync

## Domain Model (Firestore)

- `users/{uid}`
  - `payment`: { `paystackCustomerId?`, `defaultAuthorizationCode?`, `cards?: Array<{last4, brand, authorization_code, reusable}>` }
- `transactions/{txId}`
  - { `uid`, `type: 'deposit'|'withdrawal'|'transfer'|'group_contribution'`, `amount`, `status: 'pending'|'success'|'failed'`, `provider: 'paystack'`, `reference`, `createdAt`, `meta?` }
- `subscriptions/{subId}` (optional)
  - { `uid`, `plan_code`, `status`, `provider: 'paystack'`, `createdAt`, `updatedAt`, `meta` }

## Environment

- `PAYSTACK_SECRET_KEY=sk_live_or_test_xxx`
- `PAYSTACK_PUBLIC_KEY=pk_live_or_test_xxx`
- `FIREBASE_SERVICE_ACCOUNT` (JSON or use Admin default creds)
- `WEBHOOK_SECRET` (optional, if you proxy/verify yourself; Paystack uses `x-paystack-signature` HMAC with secret key)

---

## Option A: Next.js (App Router)

Install:

```bash
npm i axios firebase-admin
```

Initialize Firebase Admin once (e.g., `lib/firebase-admin.ts`):

```ts
// lib/firebase-admin.ts
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : undefined,
  });
}

export const db = getFirestore();
```

HTTP client:

```ts
// lib/paystack.ts
import axios from 'axios';

const client = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

export const paystack = {
  initialize: (data: { amount: number; email: string; reference?: string; callback_url?: string }) =>
    client.post('/transaction/initialize', data).then(r => r.data),
  verify: (reference: string) => client.get(`/transaction/verify/${reference}`).then(r => r.data),
  chargeAuthorization: (data: { authorization_code: string; email: string; amount: number; reference?: string; metadata?: any }) =>
    client.post('/transaction/charge_authorization', data).then(r => r.data),
  createPlan: (data: { name: string; amount: number; interval: 'weekly'|'monthly'|'quarterly'|'biannually'|'annually' }) =>
    client.post('/plan', data).then(r => r.data),
  subscribe: (data: { customer: string; plan: string; authorization?: string }) =>
    client.post('/subscription', data).then(r => r.data),
  // Transfers (withdrawals)
  listBanks: (country = 'NG') => client.get(`/bank?country=${country}`).then(r => r.data),
  resolveAccount: (account_number: string, bank_code: string) =>
    client.get(`/bank/resolve`, { params: { account_number, bank_code } }).then(r => r.data),
  createRecipient: (data: { type: 'nuban'; name: string; account_number: string; bank_code: string; currency?: 'NGN' }) =>
    client.post(`/transferrecipient`, data).then(r => r.data),
  initiateTransfer: (data: { source: 'balance'; amount: number; recipient: string; reason?: string; reference?: string; currency?: 'NGN' }) =>
    client.post(`/transfer`, data).then(r => r.data),
  finalizeTransfer: (data: { transfer_code: string; otp: string }) =>
    client.post(`/transfer/finalize_transfer`, data).then(r => r.data),
};
```

Routes (App Router, `app/api/.../route.ts`). If you use Pages API, export default handlers similarly.

### POST /api/payments/initialize

Body: { uid, amount, email, reference? }

Purpose: Start first-time card capture using Paystack Checkout URL. The client opens `authorization_url` in a browser. Webhook will reconcile.

```ts
// app/api/payments/initialize/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { paystack } from '@/lib/paystack';

export async function POST(req: NextRequest) {
  const { uid, amount, email, reference } = await req.json();
  if (!uid || !amount || !email) return NextResponse.json({ error: 'Missing' }, { status: 400 });

  const ref = reference ?? `TOPUP_${uid}_${Date.now()}`;
  const init = await paystack.initialize({ amount: Math.round(amount * 100), email, reference: ref });

  // record pending tx
  await db.collection('transactions').doc(ref).set({
    uid, type: 'deposit', amount, status: 'pending', provider: 'paystack', reference: ref, createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ authorization_url: init.data.authorization_url, reference: ref });
}
```

### POST /api/payments/charge

Body: { uid, amount } OR { uid, amount, authorization_code }

Purpose: On-demand top-up against stored authorization.

```ts
// app/api/payments/charge/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { paystack } from '@/lib/paystack';

export async function POST(req: NextRequest) {
  const { uid, amount, authorization_code } = await req.json();
  if (!uid || !amount) return NextResponse.json({ error: 'Missing' }, { status: 400 });

  const userRef = db.collection('users').doc(uid);
  const user = (await userRef.get()).data();
  const authCode = authorization_code || user?.payment?.defaultAuthorizationCode;
  const email = user?.phone ? `user-${uid}@coinclique.app` : user?.email || `user-${uid}@coinclique.app`;
  if (!authCode) return NextResponse.json({ error: 'No saved card' }, { status: 400 });

  const reference = `CHARGE_${uid}_${Date.now()}`;
  await db.collection('transactions').doc(reference).set({ uid, type: 'deposit', amount, status: 'pending', provider: 'paystack', reference, createdAt: new Date().toISOString() });

  const res = await paystack.chargeAuthorization({ authorization_code: authCode, email, amount: Math.round(amount * 100), reference });

  // optimistic update; rely on webhook for final truth
  return NextResponse.json({ reference, status: res.status, data: res.data });
}
```

### POST /api/payments/webhook

Headers: `x-paystack-signature`

Purpose: Verify event, update Firestore. Extract reusable `authorization` when present; store under user’s payment profile.

```ts
// app/api/payments/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/firebase-admin';

function verifySignature(secret: string, body: string, signature?: string) {
  const hash = crypto.createHmac('sha512', secret).update(body).digest('hex');
  return hash === signature;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-paystack-signature') ?? undefined;
  if (!verifySignature(process.env.PAYSTACK_SECRET_KEY!, raw, sig)) return NextResponse.json({ ok: false }, { status: 401 });

  const evt = JSON.parse(raw);
  if (evt.event === 'charge.success') {
    const { reference, amount, customer, authorization } = evt.data;
    await db.collection('transactions').doc(reference).set({ status: 'success' }, { merge: true });

    // Save card authorization for future charges
    if (authorization?.reusable && customer?.email) {
      // Find user by email scheme or store mapping uid in transaction meta
      // Example lookup by reference meta uid
      const txSnap = await db.collection('transactions').doc(reference).get();
      const uid = txSnap.data()?.uid;
      if (uid) {
        const userRef = db.collection('users').doc(uid);
        await userRef.set({
          payment: {
            defaultAuthorizationCode: authorization.authorization_code,
          },
        }, { merge: true });
      }
    }
  }

  if (evt.event === 'transfer.success' || evt.event === 'transfer.failed') {
    const { reference, status } = evt.data;
    await db.collection('withdrawals').doc(reference).set({ status }, { merge: true });
    // Mirror to transactions if you create a twin record there
    await db.collection('transactions').doc(reference).set({ status }, { merge: true });
  }

  return NextResponse.json({ ok: true });
}
```

### Optional: Subscriptions

```ts
// app/api/payments/subscriptions/create-plan/route.ts
export async function POST(req: Request) {
  const { name, amount, interval } = await req.json();
  const res = await paystack.createPlan({ name, amount: Math.round(amount * 100), interval });
  return Response.json(res);
}

// app/api/payments/subscriptions/subscribe/route.ts
export async function POST(req: Request) {
  const { uid, plan_code, authorization_code } = await req.json();
  const user = (await db.collection('users').doc(uid).get()).data();
  const customer = user?.payment?.paystackCustomerId || user?.email || `user-${uid}@coinclique.app`;
  const res = await paystack.subscribe({ customer, plan: plan_code, authorization: authorization_code || user?.payment?.defaultAuthorizationCode });
  await db.collection('subscriptions').add({ uid, plan_code, status: res.data.status, provider: 'paystack', createdAt: new Date().toISOString(), meta: res.data });
  return Response.json(res);
}
```

Client usage (mobile):
- First-time link card: call `/api/payments/initialize`, open `authorization_url` in in-app browser. Webhook stores `authorization_code`.
- Top-up: call `/api/payments/charge` with `{ uid, amount }`. Show pending → confirm via Firestore listener on `transactions/{reference}`.

---

## Withdrawals (Next.js endpoints)

High level: verify bank account, create Paystack transfer recipient, create a withdrawal request (and lock funds), initiate transfer, handle OTP if required, finalize via webhook.

### GET /api/banks
Query: `country=NG`
Returns Paystack bank list for select inputs.

```ts
// app/api/banks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { paystack } from '@/lib/paystack';
export async function GET(req: NextRequest) {
  const country = new URL(req.url).searchParams.get('country') || 'NG';
  const res = await paystack.listBanks(country);
  return NextResponse.json(res);
}
```

### POST /api/banks/resolve
Body: { account_number, bank_code }
Return: Paystack account name resolution (used before saving a beneficiary).

```ts
// app/api/banks/resolve/route.ts
import { NextResponse } from 'next/server';
import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { account_number, bank_code } = await req.json();
  if (!account_number || !bank_code) return NextResponse.json({ error: 'Missing' }, { status: 400 });
  const res = await paystack.resolveAccount(account_number, bank_code);
  return NextResponse.json(res);
}
```

### POST /api/withdrawals/recipient
Body: { uid, name, account_number, bank_code }
Creates a transfer recipient on Paystack, stores it in Firestore under `users/{uid}.payment.recipients[]`.

```ts
// app/api/withdrawals/recipient/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { uid, name, account_number, bank_code } = await req.json();
  const created = await paystack.createRecipient({ type: 'nuban', name, account_number, bank_code, currency: 'NGN' });
  await db.collection('users').doc(uid).set({
    payment: { recipients: [{ recipient_code: created.data.recipient_code, name, account_number, bank_code, createdAt: new Date().toISOString() }] }
  }, { merge: true });
  return NextResponse.json({ recipient_code: created.data.recipient_code });
}
```

### POST /api/withdrawals/request
Body: { uid, amount, recipient_code, reason? }
Creates a withdrawal record, decrements user wallet balance into a `locked` bucket to prevent double-spend. Returns a `reference`.

```ts
// app/api/withdrawals/request/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
export async function POST(req: Request) {
  const { uid, amount, recipient_code, reason } = await req.json();
  if (!uid || !amount || !recipient_code) return NextResponse.json({ error: 'Missing' }, { status: 400 });
  const ref = `WD_${uid}_${Date.now()}`;
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async (trx) => {
    const snap = await trx.get(userRef);
    const u = snap.data() || {};
    const balance = u.wallet?.balance || 0;
    if (balance < amount) throw new Error('Insufficient');
    trx.update(userRef, { 'wallet.balance': balance - amount, 'wallet.locked': (u.wallet?.locked || 0) + amount });
    trx.set(db.collection('withdrawals').doc(ref), { uid, amount, recipient_code, reason, status: 'pending', reference: ref, createdAt: new Date().toISOString(), provider: 'paystack' });
    trx.set(db.collection('transactions').doc(ref), { uid, type: 'withdrawal', amount, status: 'pending', reference: ref, provider: 'paystack', createdAt: new Date().toISOString() });
  });
  return NextResponse.json({ reference: ref });
}
```

### POST /api/withdrawals/transfer
Body: { reference }
Server initiates Paystack transfer using the previously created withdrawal record.

```ts
// app/api/withdrawals/transfer/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { reference } = await req.json();
  const wd = (await db.collection('withdrawals').doc(reference).get()).data();
  if (!wd) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const res = await paystack.initiateTransfer({ source: 'balance', amount: Math.round(wd.amount * 100), recipient: wd.recipient_code, reason: wd.reason, reference });
  // If res.data.status === 'otp' you may need to call finalizeTransfer with OTP from dashboard or configured flow
  return NextResponse.json({ ok: true, data: res.data });
}
```

> Webhook will set final `status` (success/failed) and release `wallet.locked` accordingly. On `transfer.success`, move locked → deducted permanently. On `transfer.failed`, refund `locked` back to `wallet.balance`.

### Optional: POST /api/withdrawals/finalize
Body: { transfer_code, otp }

```ts
// app/api/withdrawals/finalize/route.ts
import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { transfer_code, otp } = await req.json();
  const res = await paystack.finalizeTransfer({ transfer_code, otp });
  return Response.json(res);
}
```

---

## Groups endpoints (used by GroupContext)

These keep the Firestore writes on the server to enforce rules and prevent client-side tampering.

### POST /api/groups
Body: { uid, name, goalAmount, autoSave, frequency, image?, description?, policy?, deadline? }
Creates group doc and sets creator as first member.

### POST /api/groups/:id/join
Body: { uid }
Adds user to `members` set with validation (max members, duplicate check).

### POST /api/groups/:id/leave
Body: { uid }
Removes user (block if creator or unsettled obligations).

### POST /api/groups/:id/contribute
Body: { uid, amount, description? }
Atomically moves funds from user wallet → group pool, and writes a `transactions` record `type='group_contribution'`.

```ts
// app/api/groups/[id]/contribute/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { uid, amount, description } = await req.json();
  const groupRef = db.collection('groups').doc(params.id);
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async (trx) => {
    const [gSnap, uSnap] = await Promise.all([trx.get(groupRef), trx.get(userRef)]);
    const g = gSnap.data(); const u = uSnap.data();
    if (!g || !u) throw new Error('Missing');
    if (!(g.members || []).includes(uid)) throw new Error('Not a member');
    const balance = u.wallet?.balance || 0;
    if (balance < amount) throw new Error('Insufficient');
    trx.update(userRef, { 'wallet.balance': balance - amount });
    trx.update(groupRef, { currentAmount: (g.currentAmount || 0) + amount });
    const ref = db.collection('transactions').doc();
    trx.set(ref, { uid, groupId: params.id, type: 'group_contribution', amount, status: 'success', createdAt: new Date().toISOString(), description });
  });
  return NextResponse.json({ ok: true });
}
```

### POST /api/groups/:id/payout
Body: { uid, toMemberId, amount, reason? }
Admin-only. Debits group pool and credits member wallet (or call withdrawals API to bank if you prefer). Writes transactions for audit.

### GET /api/groups/:id
Returns group with derived stats.

### GET /api/groups/:id/transactions
Returns latest group-related transactions (contributions, payouts) for the activity tab.

## Security & Notes

- Always verify `x-paystack-signature` with your secret key (HMAC SHA512)
- Never store raw card data; only `authorization_code` + non-sensitive card metadata
- Treat `authorization_code` as sensitive and encrypt at rest if you manage your own DB
- Use webhooks as source of truth for transaction states

## Test Scenarios

- First link (initialize → webhook saves authorization)
- Charge with saved authorization → Firestore `transactions/{ref}` updates to success via webhook
- Subscription lifecycle events (optional)

## Additional Implementation Notes (to avoid mistakes)

- Idempotency:
  - Use `reference` as idempotency key on writes. Before creating a new transaction/withdrawal, check if a doc with the same reference exists.
  - Webhook processing must be idempotent; always `set(..., { merge: true })` and guard against replays.
- Amount handling:
  - Always convert Naira → Kobo via `Math.round(amount * 100)` when calling Paystack.
  - Store amounts in Naira in Firestore for readability; store provider raw amount in `meta` if useful.
- Email vs Customer:
  - If you create a Paystack Customer, store `paystackCustomerId` and prefer it over email where supported.
  - For `charge_authorization`, Paystack requires `email` + `authorization_code`. Use a stable email scheme if you don't collect email (e.g., `user-${uid}@coinclique.app`).
- Wallet locking on withdrawals:
  - Lock funds at `/withdrawals/request`, not after initiating transfer.
  - On `transfer.success`, move locked to deducted (do nothing if you've already deducted balance and lock=0). On failure, refund lock back to balance.
- Group contributions:
  - Must be transactional with wallet decrement to avoid race conditions.
  - Consider rate limiting (e.g., max N contributions/minute) to mitigate accidental double taps.
- Access control:
  - Protect all endpoints with auth middleware (e.g., Firebase Auth token). Validate `uid` from token matches body `uid`.
  - Admin-only endpoints (e.g., group payout) must verify role from Firestore (e.g., `users/{uid}.roles.admin=true`).
- Validation:
  - On recipient creation, validate name/account matches resolve result; store the resolved account_name.
  - On withdrawals, enforce minimum/maximum per tier; store limits centrally and reuse across mobile and backend.
- Observability:
  - Log every provider interaction (request/response) with redaction (no secrets) and keep `provider_response_id` for audit.
  - Consider a `jobs` collection for retries (e.g., webhook retries) with exponential backoff.




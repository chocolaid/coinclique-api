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
    const { reference, authorization } = evt.data;
    await db.collection('transactions').doc(reference).set({ status: 'success' }, { merge: true });
    const txSnap = await db.collection('transactions').doc(reference).get();
    const uid = txSnap.data()?.uid;
    if (uid && authorization?.reusable) {
      await db.collection('users').doc(uid).set({
        payment: {
          defaultAuthorizationCode: authorization.authorization_code,
          cards: [{ authorization_code: authorization.authorization_code, last4: authorization.last4, brand: authorization.card_type || authorization.brand, reusable: authorization.reusable, updatedAt: new Date().toISOString() }]
        }
      }, { merge: true });
    }
  }

  if (evt.event === 'transfer.success' || evt.event === 'transfer.failed') {
    const { reference, status } = evt.data;
    await db.collection('withdrawals').doc(reference).set({ status }, { merge: true });
    await db.collection('transactions').doc(reference).set({ status }, { merge: true });
  }

  return NextResponse.json({ ok: true });
}



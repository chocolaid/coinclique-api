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
  const secret = process.env.WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY!;
  if (!verifySignature(secret, raw, sig)) return NextResponse.json({ ok: false }, { status: 401 });

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
    const { reference, status } = evt.data as { reference: string; status: string };
    const normalized: 'success' | 'failed' = status === 'success' ? 'success' : 'failed';

    const wdRef = db.collection('withdrawals').doc(reference);
    await db.runTransaction(async (trx) => {
      const wdSnap = await trx.get(wdRef);
      const wd = wdSnap.data() as { uid: string; amount: number; status?: string } | undefined;
      if (!wd) {
        // Still mirror basic status to transactions if withdrawal record not found
        trx.set(db.collection('transactions').doc(reference), { status: normalized }, { merge: true });
        trx.set(wdRef, { status: normalized }, { merge: true });
        return;
      }

      // Idempotency: if already at final status, do nothing
      if (wd.status === normalized) {
        trx.set(db.collection('transactions').doc(reference), { status: normalized }, { merge: true });
        return;
      }

      const userRef = db.collection('users').doc(wd.uid);
      const userSnap = await trx.get(userRef);
      const u = (userSnap.data() || {}) as { wallet?: { balance?: number; locked?: number } };
      const balance = u.wallet?.balance || 0;
      const locked = u.wallet?.locked || 0;

      if (normalized === 'success') {
        // Funds already deducted from balance and moved to locked at request time; now release lock permanently
        const nextLocked = Math.max(0, locked - wd.amount);
        trx.update(userRef, { 'wallet.locked': nextLocked });
      } else {
        // Transfer failed: refund lock back to available balance
        const nextLocked = Math.max(0, locked - wd.amount);
        trx.update(userRef, { 'wallet.locked': nextLocked, 'wallet.balance': balance + wd.amount });
      }

      trx.set(wdRef, { status: normalized }, { merge: true });
      trx.set(db.collection('transactions').doc(reference), { status: normalized }, { merge: true });
    });
  }

  // Direct debit webhook examples
  if (evt.event === 'mandate.active' || evt.event === 'mandate.failed' || evt.event === 'mandate.cancelled') {
    const data = evt.data as { mandate_id?: string; status?: string; uid?: string };
    const mandateId = data?.mandate_id;
    const uidForMandate = data?.uid;
    if (uidForMandate && mandateId) {
      const userRef = db.collection('users').doc(uidForMandate);
      const snap = await userRef.get();
      const u = (snap.data() || {}) as { payment?: { mandates?: Array<Record<string, unknown>> } };
      const mandates = (u.payment?.mandates || []).map((m) => {
        const mandate = m as { mandate_id?: string } & Record<string, unknown>;
        if (mandate.mandate_id === mandateId) {
          return { ...mandate, status: data.status, updatedAt: new Date().toISOString() };
        }
        return mandate;
      });
      await userRef.set({ payment: { mandates } }, { merge: true });
    }
  }
  if (evt.event === 'direct_debit.debit_success' || evt.event === 'direct_debit.debit_failed') {
    const { reference, status } = evt.data || {};
    if (reference) {
      await db.collection('transactions').doc(reference).set({ status: status === 'success' ? 'success' : 'failed' }, { merge: true });
    }
  }

  return NextResponse.json({ ok: true });
}



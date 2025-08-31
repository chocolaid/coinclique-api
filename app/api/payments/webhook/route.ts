import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/firebase-admin';
import { notificationService } from '@/lib/notifications';
import { notificationTemplates } from '@/lib/notification-templates';

function verifySignature(secret: string, body: string, signature?: string) {
  const hash = crypto.createHmac('sha512', secret).update(body).digest('hex');
  return hash === signature;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-paystack-signature') ?? undefined;
  if (!verifySignature(process.env.PAYSTACK_SECRET_KEY!, raw, sig)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const evt = JSON.parse(raw);
  if (evt.event === 'charge.success') {
    const { reference, amount, customer, authorization, status } = (evt.data || {}) as {
      reference?: string; amount?: number; customer?: unknown; authorization?: { authorization_code: string; last4: string; card_type?: string; brand?: string; reusable: boolean; signature?: string }; status?: string;
    };
    if (reference) {
      await db.collection('transactions').doc(reference).set({ status: 'success', providerStatus: status, providerAmount: amount }, { merge: true });
    }

    if (authorization?.reusable && reference) {
      const txSnap = await db.collection('transactions').doc(reference).get();
      const uid: string | undefined = txSnap.exists ? (txSnap.data() as { uid?: string }).uid : undefined;
      if (uid) {
        // 1) Credit wallet.balance by Naira equivalent
        const naira = Math.round((amount || 0) / 100);
        const userRef = db.collection('users').doc(uid);
        await db.runTransaction(async (trx) => {
          const snap = await trx.get(userRef);
          const u = (snap.data() || {}) as { wallet?: { balance?: number } };
          trx.update(userRef, { 'wallet.balance': (u.wallet?.balance || 0) + naira });
        });

        // 2) Save/merge card, keep default if already set else set to this one
        const card = {
          id: authorization.signature || authorization.authorization_code,
          authorization_code: authorization.authorization_code,
          last4: authorization.last4,
          brand: authorization.card_type || authorization.brand,
          reusable: authorization.reusable,
          updatedAt: new Date().toISOString(),
        };
        const userRef2 = db.collection('users').doc(uid);
        const user = (await userRef2.get()).data() as { payment?: { cards?: Array<{ id?: string; authorization_code: string }>; defaultAuthorizationCode?: string } } | undefined;
        const prev = user?.payment?.cards || [];
        const filtered = prev.filter((c) => (c.id || c.authorization_code) !== (card.id || card.authorization_code));
        const currentDefault = user?.payment?.defaultAuthorizationCode;
        await userRef2.set({
          payment: {
            defaultAuthorizationCode: currentDefault || authorization.authorization_code,
            cards: [card, ...filtered],
          }
        }, { merge: true });

        // Send notification for successful payment
        await notificationService.sendNotification(uid, notificationTemplates.payment_success({
          amount: Math.round((amount || 0) / 100),
          reference,
          cardLast4: authorization?.last4
        }));
      }
    }
  }

  if (evt.event === 'transfer.success' || evt.event === 'transfer.failed') {
    const { reference, status } = evt.data as { reference: string; status: string };
    const normalized: 'success' | 'failed' = status === 'success' ? 'success' : 'failed';

    const wdRef = db.collection('withdrawals').doc(reference);
    let withdrawalData: { uid: string; amount: number; account_number?: string } | undefined;
    
    await db.runTransaction(async (trx) => {
      const wdSnap = await trx.get(wdRef);
      const wd = wdSnap.data() as { uid: string; amount: number; status?: string; account_number?: string } | undefined;
      if (!wd) {
        // Still mirror basic status to transactions if withdrawal record not found
        trx.set(db.collection('transactions').doc(reference), { status: normalized }, { merge: true });
        trx.set(wdRef, { status: normalized }, { merge: true });
        return;
      }

      // Store withdrawal data for notification
      withdrawalData = wd;

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

    // Send notification for withdrawal result
    if (withdrawalData?.uid) {
      const notificationTemplate = evt.event === 'transfer.success' 
        ? notificationTemplates.withdrawal_success 
        : notificationTemplates.withdrawal_failed;

      await notificationService.sendNotification(withdrawalData.uid, notificationTemplate({
        amount: withdrawalData.amount,
        reference,
        bankAccount: withdrawalData.account_number || 'Unknown Account'
      }));
    }
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



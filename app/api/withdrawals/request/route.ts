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



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



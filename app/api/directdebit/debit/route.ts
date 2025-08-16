import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

export async function POST(req: Request) {
  const { uid, mandate_id, amount, reference } = await req.json();
  if (!uid || !mandate_id || !amount) return NextResponse.json({ error: 'Missing' }, { status: 400 });
  const ref = reference ?? `DD_${uid}_${Date.now()}`;
  await db.collection('transactions').doc(ref).set({ uid, type: 'deposit', amount, status: 'pending', provider: 'paystack', reference: ref, createdAt: new Date().toISOString(), meta: { mandate_id } });
  // Real flow would call Paystack direct debit debit API here
  return NextResponse.json({ reference: ref, status: 'pending' });
}



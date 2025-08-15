import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { paystack } from '@/lib/paystack';

export async function POST(req: NextRequest) {
  const { uid, amount, email, reference } = await req.json();
  if (!uid || !amount || !email) return NextResponse.json({ error: 'Missing' }, { status: 400 });

  const ref = reference ?? `TOPUP_${uid}_${Date.now()}`;
  const init = await paystack.initialize({ amount: Math.round(amount * 100), email, reference: ref });

  await db.collection('transactions').doc(ref).set({
    uid, type: 'deposit', amount, status: 'pending', provider: 'paystack', reference: ref, createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ authorization_url: init.data.authorization_url, reference: ref });
}



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

  return NextResponse.json({ reference, status: res.status, data: res.data });
}



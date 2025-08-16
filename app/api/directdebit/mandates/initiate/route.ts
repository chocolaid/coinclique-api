import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

export async function POST(req: Request) {
  const { uid, bank_code, account_number, email, start_date } = await req.json();
  if (!uid || !bank_code || !account_number || !email) {
    return NextResponse.json({ error: 'Missing' }, { status: 400 });
  }

  const mandateId = `MANDATE_${uid}_${Date.now()}`;
  const userRef = db.collection('users').doc(uid);
  await userRef.set({
    payment: {
      mandates: [
        {
          mandate_id: mandateId,
          bank_code,
          account_number,
          status: 'pending',
          start_date: start_date || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  }, { merge: true });

  // In real integration, return approval link from Paystack response
  return NextResponse.json({ mandate_id: mandateId, approval_url: null, status: 'pending' });
}



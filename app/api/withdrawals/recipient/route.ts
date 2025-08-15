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



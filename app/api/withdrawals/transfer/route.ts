import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { reference } = await req.json();
  const wd = (await db.collection('withdrawals').doc(reference).get()).data();
  if (!wd) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const res = await paystack.initiateTransfer({ source: 'balance', amount: Math.round(wd.amount * 100), recipient: wd.recipient_code, reason: wd.reason, reference });
  return NextResponse.json({ ok: true, data: res.data });
}



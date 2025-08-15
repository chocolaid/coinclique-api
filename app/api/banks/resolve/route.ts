import { NextResponse } from 'next/server';
import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { account_number, bank_code } = await req.json();
  if (!account_number || !bank_code) return NextResponse.json({ error: 'Missing' }, { status: 400 });
  const res = await paystack.resolveAccount(account_number, bank_code);
  return NextResponse.json(res);
}



import { NextRequest, NextResponse } from 'next/server';
import { paystack } from '@/lib/paystack';
export async function GET(req: NextRequest) {
  const country = new URL(req.url).searchParams.get('country') || 'NG';
  const res = await paystack.listBanks(country);
  return NextResponse.json(res);
}



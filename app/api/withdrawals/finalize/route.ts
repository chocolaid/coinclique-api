import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { transfer_code, otp } = await req.json();
  const res = await paystack.finalizeTransfer({ transfer_code, otp });
  return Response.json(res);
}



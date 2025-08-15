import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { name, amount, interval } = await req.json();
  const res = await paystack.createPlan({ name, amount: Math.round(amount * 100), interval });
  return Response.json(res);
}



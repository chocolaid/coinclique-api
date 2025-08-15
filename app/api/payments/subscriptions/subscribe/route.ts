import { db } from '@/lib/firebase-admin';
import { paystack } from '@/lib/paystack';
export async function POST(req: Request) {
  const { uid, plan_code, authorization_code } = await req.json();
  const user = (await db.collection('users').doc(uid).get()).data();
  const customer = user?.payment?.paystackCustomerId || user?.email || `user-${uid}@coinclique.app`;
  const res = await paystack.subscribe({ customer, plan: plan_code, authorization: authorization_code || user?.payment?.defaultAuthorizationCode });
  await db.collection('subscriptions').add({ uid, plan_code, status: res.data.status, provider: 'paystack', createdAt: new Date().toISOString(), meta: res.data });
  return Response.json(res);
}



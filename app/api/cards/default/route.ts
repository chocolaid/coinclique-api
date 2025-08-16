import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

export async function POST(req: Request) {
  const { uid, cardId } = await req.json();
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  const u = snap.data() || {};
  const auth: string | undefined = (u.payment?.cards || []).find((c: { id?: string; authorization_code: string }) => (c.id || c.authorization_code) === cardId)?.authorization_code;
  if (!auth) return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  await userRef.set({ payment: { defaultAuthorizationCode: auth } }, { merge: true });
  return NextResponse.json({ ok: true });
}



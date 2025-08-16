import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  const uid = new URL(req.url).searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'Missing uid' }, { status: 400 });
  const u = (await db.collection('users').doc(uid).get()).data() || {};
  const def = u?.payment?.defaultAuthorizationCode;
  const cards = (u?.payment?.cards || []).map((c: { id?: string; authorization_code: string; last4: string; brand: string; updatedAt?: string }) => ({ id: c.id || c.authorization_code, last4: c.last4, brand: c.brand, updatedAt: c.updatedAt, isDefault: c.authorization_code === def }));
  return NextResponse.json({ cards });
}

export async function DELETE(req: Request) {
  const { uid, cardId } = await req.json();
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  const u = snap.data() || {};
  const list: Array<{ id?: string; authorization_code: string }> = (u.payment?.cards || []);
  const filtered = list.filter((c) => (c.id || c.authorization_code) !== cardId);
  const def: string | undefined = u.payment?.defaultAuthorizationCode;
  let nextDefault: string | null | undefined = def;
  const removed = list.find((c) => (c.id || c.authorization_code) === cardId)?.authorization_code;
  if (removed && removed === def) nextDefault = filtered[0]?.authorization_code || null;
  await userRef.set({ payment: { cards: filtered, defaultAuthorizationCode: nextDefault } }, { merge: true });
  return NextResponse.json({ ok: true });
}



import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const uid = new URL(req.url).searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'Missing uid' }, { status: 400 });
  const u = (await db.collection('users').doc(uid).get()).data() || {};
  const m = (u.payment?.mandates || []).find((x: { mandate_id: string }) => x.mandate_id === id);
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ mandate: m });
}



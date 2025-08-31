import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

// Helper function to verify Firebase token
async function verifyAuthToken(req: NextRequest): Promise<string | null> {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await getAuth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const snapshot = await db.collection('notifications')
      .where('uid', '==', uid)
      .where('status', '==', 'unread')
      .count()
      .get();

    return NextResponse.json({
      success: true,
      count: snapshot.data().count,
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

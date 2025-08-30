import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function GET(req: NextRequest) {
  try {
    // Verify Firebase token
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization token', code: 'INVALID_TOKEN' },
        { status: 401 }
      );
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await getAuth().verifyIdToken(token);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token', code: 'INVALID_TOKEN' },
        { status: 401 }
      );
    }

    const uid = decodedToken.uid;

    // Get count of pending invites for the user
    const invitesRef = db.collection('invites');
    const invitesQuery = await invitesRef
      .where('userId', '==', uid)
      .where('status', '==', 'pending')
      .get();

    let count = 0;
    
    for (const inviteDoc of invitesQuery.docs) {
      const inviteData = inviteDoc.data();
      
      // Check if invite is expired
      if (inviteData.expiresAt && new Date(inviteData.expiresAt) < new Date()) {
        // Mark invite as expired
        await inviteDoc.ref.update({ status: 'expired' });
        continue;
      }
      
      // Check if group still exists
      const groupDoc = await db.collection('groups').doc(inviteData.groupId).get();
      if (groupDoc.exists) {
        count++;
      }
    }

    return NextResponse.json({
      success: true,
      count
    });

  } catch (error) {
    console.error('Error fetching pending invites count:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

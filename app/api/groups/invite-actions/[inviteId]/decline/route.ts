import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function POST(req: NextRequest, context: { params: Promise<{ inviteId: string }> }) {
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
    const { inviteId } = await context.params;

    // Get invite details
    const inviteDoc = await db.collection('invites').doc(inviteId).get();
    
    if (!inviteDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Invite not found', code: 'INVITE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const inviteData = inviteDoc.data();
    
    // Check if invite is for the authenticated user
    if (inviteData?.userId !== uid) {
      return NextResponse.json(
        { success: false, error: 'Access denied', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Check if invite is still pending
    if (inviteData?.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: 'Invite is no longer pending', code: 'INVITE_NOT_PENDING' },
        { status: 400 }
      );
    }

    // Update invite status to declined
    await inviteDoc.ref.update({
      status: 'declined',
      declinedAt: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      message: 'Invitation declined'
    });

  } catch (error) {
    console.error('Error declining invite:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

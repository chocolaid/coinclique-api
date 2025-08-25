import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function GET(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
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
    const { groupId } = await context.params;

    // Get group details
    const groupDoc = await db.collection('groups').doc(groupId).get();
    
    if (!groupDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
        { status: 404 }
      );
    }

    const groupData = groupDoc.data();
    
    // Check if user is a member
    if (!groupData?.members?.includes(uid)) {
      return NextResponse.json(
        { success: false, error: 'Access denied', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Get all invites for this group
    const invitesRef = db.collection('invites');
    const invitesQuery = await invitesRef
      .where('groupId', '==', groupId)
      .orderBy('invitedAt', 'desc')
      .get();

    const invites = [];
    
    for (const inviteDoc of invitesQuery.docs) {
      const inviteData = inviteDoc.data();
      
      // Get user details for each invite
      const userDoc = await db.collection('users').doc(inviteData.userId).get();
      const userData = userDoc.data();
      
      // Get inviter details
      const inviterDoc = await db.collection('users').doc(inviteData.invitedBy).get();
      const inviterData = inviterDoc.data();

      invites.push({
        inviteId: inviteDoc.id,
        groupId: inviteData.groupId,
        userId: inviteData.userId,
        invitedBy: inviteData.invitedBy,
        status: inviteData.status,
        invitedAt: inviteData.invitedAt,
        expiresAt: inviteData.expiresAt,
        user: {
          uid: inviteData.userId,
          name: userData?.name || 'Unknown User',
          phone: userData?.phone || '',
          avatar: userData?.avatar || ''
        },
        inviter: {
          uid: inviteData.invitedBy,
          name: inviterData?.name || 'Unknown User',
          phone: inviterData?.phone || '',
          avatar: inviterData?.avatar || ''
        }
      });
    }

    return NextResponse.json({
      success: true,
      invites
    });

  } catch (error) {
    console.error('Error fetching group invites:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

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

    // Get all pending invites for the user
    const invitesRef = db.collection('invites');
    const invitesQuery = await invitesRef
      .where('userId', '==', uid)
      .where('status', '==', 'pending')
      .orderBy('invitedAt', 'desc')
      .get();

    const invites = [];
    
    for (const inviteDoc of invitesQuery.docs) {
      const inviteData = inviteDoc.data();
      
      // Check if invite is expired
      if (inviteData.expiresAt && new Date(inviteData.expiresAt) < new Date()) {
        // Mark invite as expired
        await inviteDoc.ref.update({ status: 'expired' });
        continue;
      }
      
      // Get group details
      const groupDoc = await db.collection('groups').doc(inviteData.groupId).get();
      if (!groupDoc.exists) {
        continue; // Skip if group no longer exists
      }
      
      const groupData = groupDoc.data();
      
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
        maxUses: inviteData.maxUses || null,
        currentUses: inviteData.currentUses || 0,
        inviteCode: inviteData.inviteCode || null,
        group: {
          name: groupData.name,
          description: groupData.description,
          goalAmount: groupData.goalAmount,
          currentAmount: groupData.currentAmount || 0,
          status: groupData.status,
          members: groupData.members || [],
          policy: groupData.policy
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
    console.error('Error fetching pending invites:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

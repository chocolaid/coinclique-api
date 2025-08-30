import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';

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

    // Check if invite is expired
    if (inviteData?.expiresAt && new Date(inviteData.expiresAt) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'Invite has expired', code: 'INVITE_EXPIRED' },
        { status: 400 }
      );
    }

    const groupId = inviteData.groupId;

    // Get group details
    const groupDoc = await db.collection('groups').doc(groupId).get();
    
    if (!groupDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
        { status: 404 }
      );
    }

    const groupData = groupDoc.data();
    
    // Check if user is already a member
    if (groupData?.members?.includes(uid)) {
      return NextResponse.json(
        { success: false, error: 'You are already a member of this group', code: 'ALREADY_MEMBER' },
        { status: 400 }
      );
    }

    // Check if group allows member addition
    if (groupData?.policy?.allowMemberAddition === false) {
      return NextResponse.json(
        { success: false, error: 'Group does not allow new members', code: 'MEMBER_ADDITION_DISABLED' },
        { status: 400 }
      );
    }

    // Check if group is full
    if (groupData?.members?.length >= groupData?.policy?.maxMembers) {
      return NextResponse.json(
        { success: false, error: 'Group has reached maximum member limit', code: 'GROUP_FULL' },
        { status: 400 }
      );
    }

    // Use transaction to ensure data consistency
    await db.runTransaction(async (transaction) => {
      // Re-read group data in transaction
      const groupRef = db.collection('groups').doc(groupId);
      const groupSnap = await transaction.get(groupRef);
      const currentGroupData = groupSnap.data();
      
      if (!currentGroupData) {
        throw new Error('Group not found');
      }

      // Double-check member limit in transaction
      if (currentGroupData.members && currentGroupData.members.length >= currentGroupData.policy?.maxMembers) {
        throw new Error('Group is full');
      }

      // Add user to group
      transaction.update(groupRef, {
        members: FieldValue.arrayUnion(uid),
        updatedAt: new Date().toISOString()
      });

      // Add group to user's groups
      const userRef = db.collection('users').doc(uid);
      transaction.update(userRef, {
        groups: FieldValue.arrayUnion(groupId)
      });

      // Create group member record
      const memberRef = db.collection('group_members').doc(`${groupId}_${uid}`);
      transaction.set(memberRef, {
        groupId,
        userId: uid,
        joinedAt: new Date().toISOString(),
        totalContributed: 0,
        lastContributionDate: null,
        contributionCount: 0,
        status: 'active',
        autoSaveEnabled: false,
        nextAutoSaveDate: null
      });

      // Update invite status
      transaction.update(inviteDoc.ref, {
        status: 'accepted',
        acceptedAt: new Date().toISOString()
      });

      // Update group status if minimum members reached
      if (currentGroupData.members && currentGroupData.members.length + 1 >= currentGroupData.policy?.minMembers) {
        transaction.update(groupRef, {
          status: 'active'
        });
      }
    });

    // Send system message to group chat
    await sendSystemMessage(groupId, 'User joined the group', 'status_change', {
      statusChange: 'member_joined',
      memberCount: (groupData?.members?.length || 0) + 1
    });

    return NextResponse.json({
      success: true,
      message: 'Successfully joined group',
      groupId,
      groupName: groupData?.name || 'Unknown Group'
    });

  } catch (error) {
    console.error('Error accepting invite:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Group not found') {
        return NextResponse.json(
          { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
          { status: 404 }
        );
      }
      
      if (error.message === 'Group is full') {
        return NextResponse.json(
          { success: false, error: 'Group has reached maximum member limit', code: 'GROUP_FULL' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// Helper function to send system messages
async function sendSystemMessage(groupId: string, text: string, messageType: string, metadata: Record<string, unknown> | null = null) {
  try {
    const messageData = {
      groupId,
      userId: 'system',
      text,
      timestamp: new Date().toISOString(),
      userName: 'System',
      userAvatar: '',
      messageType,
      metadata
    };

    await db.collection('group_messages').add(messageData);
  } catch (error) {
    console.error('Error sending system message:', error);
  }
}

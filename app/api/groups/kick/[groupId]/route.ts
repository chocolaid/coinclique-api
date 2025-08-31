import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { notificationService } from '@/lib/notifications';
import { notificationTemplates } from '@/lib/notification-templates';

export async function POST(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
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
    const body = await req.json();

    const { userId, reason } = body;
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required', code: 'MISSING_USER_ID' },
        { status: 400 }
      );
    }

    // Get group details
    const groupDoc = await db.collection('groups').doc(groupId).get();
    
    if (!groupDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
        { status: 404 }
      );
    }

    const groupData = groupDoc.data();
    
    // Check if user is the group creator
    if (groupData?.creator !== uid) {
      return NextResponse.json(
        { success: false, error: 'Only group creator can kick members', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Check if group allows member removal
    if (groupData?.policy?.allowMemberRemoval === false) {
      return NextResponse.json(
        { success: false, error: 'Group does not allow member removal', code: 'MEMBER_REMOVAL_DISABLED' },
        { status: 400 }
      );
    }

    // Check if user to be kicked is a member
    if (!groupData?.members?.includes(userId)) {
      return NextResponse.json(
        { success: false, error: 'User is not a member of this group', code: 'NOT_MEMBER' },
        { status: 400 }
      );
    }

    // Check if trying to kick the creator
    if (userId === groupData?.creator) {
      return NextResponse.json(
        { success: false, error: 'Cannot kick group creator', code: 'CANNOT_KICK_CREATOR' },
        { status: 400 }
      );
    }

    // Check minimum member requirement
    if (groupData?.members?.length <= groupData?.policy?.minMembers) {
      return NextResponse.json(
        { success: false, error: 'Cannot kick member. Minimum member requirement would not be met.', code: 'MIN_MEMBERS_REQUIRED' },
        { status: 400 }
      );
    }

    // Get member contribution data before transaction
    const memberRef = db.collection('group_members').doc(`${groupId}_${userId}`);
    const memberDoc = await memberRef.get();
    const memberData = memberDoc.data();
    const totalContributed = memberData?.totalContributed || 0;
    
    // Calculate penalty (higher than voluntary leave)
    const penaltyRate = (groupData.policy?.earlyWithdrawalPenalty || 10) + 5; // 5% extra for being kicked
    const penaltyAmount = Math.round((totalContributed * penaltyRate) / 100);
    const refundAmount = totalContributed - penaltyAmount;

    // Use transaction to ensure data consistency
    await db.runTransaction(async (transaction) => {
      // Re-read group data in transaction
      const groupRef = db.collection('groups').doc(groupId);
      const groupSnap = await transaction.get(groupRef);
      const currentGroupData = groupSnap.data();
      
      if (!currentGroupData) {
        throw new Error('Group not found');
      }

      // Double-check member count in transaction
      if (currentGroupData.members && currentGroupData.members.length <= currentGroupData.policy?.minMembers) {
        throw new Error('Minimum members required');
      }

      // Remove user from group
      transaction.update(groupRef, {
        members: FieldValue.arrayRemove(userId),
        currentAmount: currentGroupData.currentAmount - refundAmount,
        updatedAt: new Date().toISOString()
      });

      // Remove group from user's groups
      const userRef = db.collection('users').doc(userId);
      transaction.update(userRef, {
        groups: FieldValue.arrayRemove(groupId)
      });

      // Update user's wallet (penalty can make balance negative)
      const userSnap = await transaction.get(userRef);
      const userData = userSnap.data();
      const currentBalance = userData?.wallet?.balance || 0;
      
      transaction.update(userRef, {
        'wallet.balance': currentBalance + refundAmount - penaltyAmount
      });

      // Create transaction records
      const transactionRef = db.collection('transactions').doc();
      transaction.set(transactionRef, {
        uid: userId,
        groupId,
        type: 'group_refund',
        amount: refundAmount,
        status: 'success',
        createdAt: new Date().toISOString(),
        description: 'Kicked from group - funds returned'
      });

      if (penaltyAmount > 0) {
        const penaltyRef = db.collection('transactions').doc();
        transaction.set(penaltyRef, {
          uid: userId,
          groupId,
          type: 'group_penalty',
          amount: penaltyAmount,
          status: 'success',
          createdAt: new Date().toISOString(),
          description: 'Kicked from group penalty'
        });
      }

      // Delete member record
      transaction.delete(memberRef);

      // Update group status if needed
      if (currentGroupData.members.length - 1 < currentGroupData.policy?.minMembers) {
        transaction.update(groupRef, {
          status: 'paused',
          updatedAt: new Date().toISOString()
        });
      }
    });

    // Send system message to group chat
    await sendSystemMessage(groupId, `User was removed from group (penalty: ₦${penaltyAmount.toLocaleString()})`, 'status_change', {
      statusChange: 'member_kicked',
      penaltyAmount,
      refundAmount,
      totalContributed,
      reason: reason || 'No reason provided'
    });

    // Send notification to the kicked user
    try {
      await notificationService.sendNotification(userId, notificationTemplates.penalty_applied({
        groupId,
        groupName: groupData.name,
        amount: penaltyAmount,
        reason: `Kicked from group: ${reason || 'No reason provided'}`,
        penaltyType: 'kicked',
        newBalance: (groupData.wallet?.balance || 0) - penaltyAmount
      }));
    } catch (notificationError) {
      console.error('Error sending kick notification:', notificationError);
    }

    // Send notification to remaining group members
    const remainingMembers = groupData.members.filter((memberId: string) => memberId !== userId && memberId !== uid);
    if (remainingMembers.length > 0) {
      try {
        await notificationService.sendBatchNotification(remainingMembers, notificationTemplates.member_left({
          groupId,
          groupName: groupData.name,
          userId,
          userName: 'A member',
          memberCount: remainingMembers.length,
          reason: `Kicked by group creator: ${reason || 'No reason provided'}`
        }));
      } catch (notificationError) {
        console.error('Error sending kick notification to group:', notificationError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'User kicked successfully',
      penaltyApplied: penaltyAmount,
      refundAmount,
      totalContributed
    });

  } catch (error) {
    console.error('Error kicking user:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Group not found') {
        return NextResponse.json(
          { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
          { status: 404 }
        );
      }
      
      if (error.message === 'Minimum members required') {
        return NextResponse.json(
          { success: false, error: 'Cannot kick member. Minimum member requirement would not be met.', code: 'MIN_MEMBERS_REQUIRED' },
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

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
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

    // Check if group has auto-save enabled
    if (!groupData?.autoSave && !groupData?.policy?.autoSaveEnabled) {
      return NextResponse.json(
        { success: false, error: 'Auto-save is not enabled for this group', code: 'AUTO_SAVE_DISABLED' },
        { status: 400 }
      );
    }

    // Get member data
    const memberRef = db.collection('group_members').doc(`${groupId}_${uid}`);
    const memberDoc = await memberRef.get();
    const memberData = memberDoc.data();

    if (!memberData) {
      return NextResponse.json(
        { success: false, error: 'Member data not found', code: 'MEMBER_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Check if member has auto-save enabled
    if (!memberData.autoSaveEnabled) {
      return NextResponse.json(
        { success: false, error: 'Auto-save is not enabled for this member', code: 'MEMBER_AUTO_SAVE_DISABLED' },
        { status: 400 }
      );
    }

    // Check if it's time for auto-save
    const now = new Date();
    const nextAutoSaveDate = memberData.nextAutoSaveDate ? new Date(memberData.nextAutoSaveDate) : null;
    
    if (nextAutoSaveDate && now < nextAutoSaveDate) {
      return NextResponse.json(
        { success: false, error: 'Auto-save is not due yet', code: 'AUTO_SAVE_NOT_DUE' },
        { status: 400 }
      );
    }

    const autoSaveAmount = groupData.autoSaveAmount || groupData.policy?.fixedAmount || 0;
    
    if (autoSaveAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Auto-save amount is not configured', code: 'AUTO_SAVE_AMOUNT_NOT_SET' },
        { status: 400 }
      );
    }

    // Get user data to check wallet balance
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const currentBalance = userData?.wallet?.balance || 0;

    if (currentBalance < autoSaveAmount) {
      // Apply penalty for insufficient funds
      const penaltyRate = groupData.policy?.lateContributionPenalty || 5;
      const penaltyAmount = Math.round((autoSaveAmount * penaltyRate) / 100);
      
      // Update user's wallet (can go negative)
      await db.collection('users').doc(uid).update({
        'wallet.balance': currentBalance - penaltyAmount
      });

      // Create penalty transaction record
      await db.collection('transactions').add({
        uid,
        groupId,
        type: 'auto_save_penalty',
        amount: penaltyAmount,
        status: 'success',
        createdAt: new Date().toISOString(),
        description: 'Auto-save failed - insufficient funds penalty'
      });

      // Send system message
      await sendSystemMessage(groupId, `Auto-save failed for user (penalty: ₦${penaltyAmount.toLocaleString()})`, 'penalty', {
        penaltyAmount,
        userId: uid,
        reason: 'Insufficient funds for auto-save'
      });

      return NextResponse.json({
        success: false,
        error: 'Insufficient funds for auto-save',
        penaltyApplied: penaltyAmount,
        code: 'INSUFFICIENT_FUNDS'
      });
    }

    // Process auto-save contribution
    await db.runTransaction(async (transaction) => {
      // Re-read group and user data in transaction
      const groupRef = db.collection('groups').doc(groupId);
      const userRef = db.collection('users').doc(uid);
      
      const [groupSnap, userSnap] = await Promise.all([
        transaction.get(groupRef),
        transaction.get(userRef)
      ]);
      
      const g = groupSnap.data();
      const u = userSnap.data();
      
      if (!g || !u) {
        throw new Error('Group or user not found');
      }

      // Check if group has reached goal
      if (g.currentAmount >= g.goalAmount) {
        throw new Error('Group has already reached its goal');
      }

      // Update user wallet
      transaction.update(userRef, {
        'wallet.balance': (u.wallet?.balance || 0) - autoSaveAmount
      });

      // Update group amount
      transaction.update(groupRef, {
        currentAmount: (g.currentAmount || 0) + autoSaveAmount,
        updatedAt: new Date().toISOString()
      });

      // Update member contribution record
      transaction.update(memberRef, {
        totalContributed: (memberData.totalContributed || 0) + autoSaveAmount,
        lastContributionDate: new Date().toISOString(),
        contributionCount: (memberData.contributionCount || 0) + 1,
        nextAutoSaveDate: getNextAutoSaveDate(groupData.frequency, groupData.autoSaveDay)
      });

      // Create transaction record
      const transactionRef = db.collection('transactions').doc();
      transaction.set(transactionRef, {
        uid,
        groupId,
        type: 'auto_save_contribution',
        amount: autoSaveAmount,
        status: 'success',
        createdAt: new Date().toISOString(),
        description: 'Auto-save contribution',
        groupName: g.name
      });

      // Check if group has reached its goal
      if ((g.currentAmount || 0) + autoSaveAmount >= g.goalAmount) {
        transaction.update(groupRef, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    });

    // Send system message to group chat
    await sendSystemMessage(groupId, `Auto-save contribution: ₦${autoSaveAmount.toLocaleString()}`, 'contribution', {
      contributionAmount: autoSaveAmount,
      userId: uid,
      isAutoSave: true
    });

    // Notify other group members about the auto-save contribution
    const otherMembers = groupData.members.filter((memberId: string) => memberId !== uid);
    if (otherMembers.length > 0) {
      try {
        await notificationService.sendBatchNotification(otherMembers, notificationTemplates.contribution_made({
          groupId,
          groupName: groupData.name,
          amount: autoSaveAmount,
          totalContributed: (groupData.currentAmount || 0) + autoSaveAmount,
          goalProgress: Math.round(((groupData.currentAmount || 0) + autoSaveAmount) / groupData.goalAmount * 100)
        }));
      } catch (notificationError) {
        console.error('Error sending auto-save notification:', notificationError);
      }
    }

    // Check if group reached its goal and notify all members
    if ((groupData.currentAmount || 0) + autoSaveAmount >= groupData.goalAmount) {
      try {
        await notificationService.sendBatchNotification(groupData.members, notificationTemplates.group_goal_reached({
          groupId,
          groupName: groupData.name,
          goalAmount: groupData.goalAmount,
          currentAmount: (groupData.currentAmount || 0) + autoSaveAmount,
          memberCount: groupData.members.length
        }));
      } catch (notificationError) {
        console.error('Error sending goal reached notification:', notificationError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Auto-save processed successfully',
      amount: autoSaveAmount,
      nextAutoSaveDate: getNextAutoSaveDate(groupData.frequency, groupData.autoSaveDay)
    });

  } catch (error) {
    console.error('Error processing auto-save:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Group or user not found') {
        return NextResponse.json(
          { success: false, error: 'Group or user not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      
      if (error.message === 'Group has already reached its goal') {
        return NextResponse.json(
          { success: false, error: 'Group has already reached its goal', code: 'GOAL_REACHED' },
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

// Helper function to get next auto-save date
function getNextAutoSaveDate(frequency: string, autoSaveDay: number): string {
  const now = new Date();
  const nextDate = new Date(now);
  
  switch (frequency) {
    case 'daily':
      nextDate.setDate(now.getDate() + 1);
      break;
    case 'weekly':
      nextDate.setDate(now.getDate() + 7);
      break;
    case 'monthly':
      nextDate.setMonth(now.getMonth() + 1);
      nextDate.setDate(autoSaveDay);
      break;
    default:
      nextDate.setDate(now.getDate() + 1);
  }
  
  return nextDate.toISOString();
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

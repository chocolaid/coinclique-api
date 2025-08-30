import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

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
    
    // Check if user is the group creator
    if (groupData?.creator !== uid) {
      return NextResponse.json(
        { success: false, error: 'Only group creator can process deadline', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Check if group is active
    if (groupData?.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Group is not active', code: 'GROUP_NOT_ACTIVE' },
        { status: 400 }
      );
    }

    const deadline = new Date(groupData.deadline);
    const now = new Date();
    
    // Check if deadline has been reached
    if (now < deadline) {
      return NextResponse.json(
        { success: false, error: 'Deadline has not been reached yet', code: 'DEADLINE_NOT_REACHED' },
        { status: 400 }
      );
    }

    const currentAmount = groupData.currentAmount || 0;
    const goalAmount = groupData.goalAmount;
    const members = groupData.members || [];
    const policy = groupData.policy || {};

    let action = '';
    let message = '';

    // Use transaction to ensure data consistency
    await db.runTransaction(async (transaction) => {
      const groupRef = db.collection('groups').doc(groupId);
      
      if (currentAmount >= goalAmount) {
        // Goal reached - distribute funds with bonuses
        action = 'goal_reached';
        message = 'Group goal reached, distributing funds with bonuses';
        
        const earlyCompletionBonus = policy.earlyCompletionBonus || 0;
        const bonusAmount = Math.round((currentAmount * earlyCompletionBonus) / 100);
        const totalToDistribute = currentAmount + bonusAmount;
        const amountPerMember = totalToDistribute / members.length;
        
        // Distribute funds to all members
        for (const memberId of members) {
          const userRef = db.collection('users').doc(memberId);
          const userSnap = await transaction.get(userRef);
          const userData = userSnap.data();
          const currentBalance = userData?.wallet?.balance || 0;
          
          transaction.update(userRef, {
            'wallet.balance': currentBalance + amountPerMember
          });

          // Create transaction record
          const transactionRef = db.collection('transactions').doc();
          transaction.set(transactionRef, {
            uid: memberId,
            groupId,
            type: 'goal_completion_distribution',
            amount: amountPerMember,
            status: 'success',
            createdAt: new Date().toISOString(),
            description: 'Goal completion distribution with bonus'
          });
        }
        
        // Update group status
        transaction.update(groupRef, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        
      } else {
        // Goal not reached - apply penalties and distribute remaining funds
        action = 'deadline_reached';
        message = 'Group deadline reached, goal not met, applying penalties';
        
        const lateContributionPenalty = policy.lateContributionPenalty || 5;
        const amountPerMember = currentAmount / members.length;
        
        // Apply penalties and distribute funds
        for (const memberId of members) {
          const userRef = db.collection('users').doc(memberId);
          const userSnap = await transaction.get(userRef);
          const userData = userSnap.data();
          const currentBalance = userData?.wallet?.balance || 0;
          
          // Calculate penalty for this member
          const penaltyAmount = Math.round((amountPerMember * lateContributionPenalty) / 100);
          const refundAmount = amountPerMember - penaltyAmount;
          
          transaction.update(userRef, {
            'wallet.balance': currentBalance + refundAmount - penaltyAmount
          });

          // Create transaction records
          if (refundAmount > 0) {
            const refundRef = db.collection('transactions').doc();
            transaction.set(refundRef, {
              uid: memberId,
              groupId,
              type: 'deadline_refund',
              amount: refundAmount,
              status: 'success',
              createdAt: new Date().toISOString(),
              description: 'Deadline reached - partial refund'
            });
          }
          
          if (penaltyAmount > 0) {
            const penaltyRef = db.collection('transactions').doc();
            transaction.set(penaltyRef, {
              uid: memberId,
              groupId,
              type: 'deadline_penalty',
              amount: penaltyAmount,
              status: 'success',
              createdAt: new Date().toISOString(),
              description: 'Deadline reached - goal not met penalty'
            });
          }
        }
        
        // Update group status
        transaction.update(groupRef, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    });

    // Send system message to group chat
    await sendSystemMessage(groupId, message, 'status_change', {
      statusChange: action,
      goalReached: currentAmount >= goalAmount,
      finalAmount: currentAmount,
      goalAmount
    });

    return NextResponse.json({
      success: true,
      action,
      message
    });

  } catch (error) {
    console.error('Error processing group deadline:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// Helper function to send system messages
async function sendSystemMessage(groupId: string, text: string, messageType: string, metadata: any = null) {
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

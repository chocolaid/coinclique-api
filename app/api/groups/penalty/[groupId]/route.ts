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
    const body = await req.json();

    const { userId, amount, reason } = body;
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required', code: 'MISSING_USER_ID' },
        { status: 400 }
      );
    }

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid penalty amount is required', code: 'INVALID_AMOUNT' },
        { status: 400 }
      );
    }

    if (!reason || reason.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Penalty reason is required', code: 'MISSING_REASON' },
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
        { success: false, error: 'Only group creator can apply penalties', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Check if user to be penalized is a member
    if (!groupData?.members?.includes(userId)) {
      return NextResponse.json(
        { success: false, error: 'User is not a member of this group', code: 'NOT_MEMBER' },
        { status: 400 }
      );
    }

    // Check if trying to penalize the creator
    if (userId === groupData?.creator) {
      return NextResponse.json(
        { success: false, error: 'Cannot apply penalty to group creator', code: 'CANNOT_PENALIZE_CREATOR' },
        { status: 400 }
      );
    }

    // Use transaction to ensure data consistency
    await db.runTransaction(async (transaction) => {
      // Re-read user data in transaction
      const userRef = db.collection('users').doc(userId);
      const userSnap = await transaction.get(userRef);
      const userData = userSnap.data();
      
      if (!userData) {
        throw new Error('User not found');
      }

      // Update user's wallet (penalty can make balance negative)
      const currentBalance = userData.wallet?.balance || 0;
      transaction.update(userRef, {
        'wallet.balance': currentBalance - amount
      });

      // Create penalty record
      const penaltyRef = db.collection('penalties').doc();
      transaction.set(penaltyRef, {
        penaltyId: penaltyRef.id,
        userId,
        groupId,
        type: 'rule_violation',
        amount,
        reason: reason.trim(),
        appliedAt: new Date().toISOString(),
        status: 'paid',
        paidAt: new Date().toISOString(),
        appliedBy: uid
      });

      // Create transaction record
      const transactionRef = db.collection('transactions').doc();
      transaction.set(transactionRef, {
        uid: userId,
        groupId,
        type: 'penalty_application',
        amount,
        status: 'success',
        createdAt: new Date().toISOString(),
        description: `Penalty applied: ${reason.trim()}`,
        groupName: groupData.name
      });
    });

    // Send system message to group chat
    await sendSystemMessage(groupId, `Penalty applied to user: ₦${amount.toLocaleString()} - ${reason.trim()}`, 'penalty', {
      penaltyAmount: amount,
      userId,
      reason: reason.trim(),
      appliedBy: uid
    });

    return NextResponse.json({
      success: true,
      penaltyId: `penalty_${Date.now()}`,
      message: 'Penalty applied successfully'
    });

  } catch (error) {
    console.error('Error applying penalty:', error);
    
    if (error instanceof Error) {
      if (error.message === 'User not found') {
        return NextResponse.json(
          { success: false, error: 'User not found', code: 'USER_NOT_FOUND' },
          { status: 404 }
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
async function sendSystemMessage(groupId: string, text: string, messageType: string, metadata: Record<string, any> | null = null) {
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

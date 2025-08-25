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
    
    // Check if user is a member
    if (!groupData?.members?.includes(uid)) {
      return NextResponse.json(
        { success: false, error: 'You are not a member of this group', code: 'NOT_MEMBER' },
        { status: 400 }
      );
    }

    // Check if user is the creator
    if (groupData?.creator === uid) {
      return NextResponse.json(
        { success: false, error: 'Group creator cannot leave. Transfer ownership or delete the group instead.', code: 'CREATOR_CANNOT_LEAVE' },
        { status: 400 }
      );
    }

    // Check if group allows member removal
    if (groupData?.policy?.allowMemberRemoval === false) {
      return NextResponse.json(
        { success: false, error: 'Group does not allow members to leave', code: 'MEMBER_LEAVE_DISABLED' },
        { status: 400 }
      );
    }

    // Check minimum member requirement
    if (groupData?.members?.length <= groupData?.policy?.minMembers) {
      return NextResponse.json(
        { success: false, error: 'Cannot leave group. Minimum member requirement would not be met.', code: 'MIN_MEMBERS_REQUIRED' },
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

      // Double-check member count in transaction
      if (currentGroupData.members && currentGroupData.members.length <= currentGroupData.policy?.minMembers) {
        throw new Error('Minimum members required');
      }

      // Calculate user's share of the group funds
      const userContribution = await calculateUserContribution(groupId, uid);
      const totalMembers = currentGroupData.members.length;
      const userShare = userContribution + (currentGroupData.currentAmount / totalMembers);

      // Remove user from group
      transaction.update(groupRef, {
        members: db.FieldValue.arrayRemove(uid),
        currentAmount: currentGroupData.currentAmount - userShare,
        updatedAt: new Date().toISOString()
      });

      // Remove group from user's groups
      const userRef = db.collection('users').doc(uid);
      transaction.update(userRef, {
        groups: db.FieldValue.arrayRemove(groupId)
      });

      // Add funds back to user's wallet
      const userSnap = await transaction.get(userRef);
      const userData = userSnap.data();
      const currentBalance = userData?.wallet?.balance || 0;
      
      transaction.update(userRef, {
        'wallet.balance': currentBalance + userShare
      });

      // Create transaction record
      const transactionRef = db.collection('transactions').doc();
      transaction.set(transactionRef, {
        uid,
        groupId,
        type: 'group_withdrawal',
        amount: userShare,
        status: 'success',
        createdAt: new Date().toISOString(),
        description: 'Left group - funds returned'
      });

      // Update group status if needed
      if (currentGroupData.members.length - 1 < currentGroupData.policy?.minMembers) {
        transaction.update(groupRef, {
          status: 'paused',
          updatedAt: new Date().toISOString()
        });
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Successfully left group'
    });

  } catch (error) {
    console.error('Error leaving group:', error);
    
    if (error.message === 'Group not found') {
      return NextResponse.json(
        { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
        { status: 404 }
      );
    }
    
    if (error.message === 'Minimum members required') {
      return NextResponse.json(
        { success: false, error: 'Cannot leave group. Minimum member requirement would not be met.', code: 'MIN_MEMBERS_REQUIRED' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// Helper function to calculate user's total contribution to the group
async function calculateUserContribution(groupId: string, uid: string): Promise<number> {
  const transactionsRef = db.collection('transactions');
  const contributionsQuery = await transactionsRef
    .where('groupId', '==', groupId)
    .where('uid', '==', uid)
    .where('type', '==', 'group_contribution')
    .where('status', '==', 'success')
    .get();

  let totalContribution = 0;
  contributionsQuery.docs.forEach(doc => {
    const data = doc.data();
    totalContribution += data.amount || 0;
  });

  return totalContribution;
}

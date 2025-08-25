import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function DELETE(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
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
    
    // Check if user is the creator
    if (groupData?.creator !== uid) {
      return NextResponse.json(
        { success: false, error: 'Only group creator can delete group', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Check if group is active
    if (groupData?.status !== 'active' && groupData?.status !== 'paused') {
      return NextResponse.json(
        { success: false, error: 'Cannot delete group in current status', code: 'INVALID_GROUP_STATUS' },
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

      const members = currentGroupData.members || [];
      const currentAmount = currentGroupData.currentAmount || 0;

      // Distribute funds back to members if there are funds
      if (currentAmount > 0 && members.length > 0) {
        const amountPerMember = currentAmount / members.length;
        
        for (const memberId of members) {
          const userRef = db.collection('users').doc(memberId);
          const userSnap = await transaction.get(userRef);
          const userData = userSnap.data();
          const currentBalance = userData?.wallet?.balance || 0;
          
          // Add member's share back to their wallet
          transaction.update(userRef, {
            'wallet.balance': currentBalance + amountPerMember
          });

          // Create transaction record for fund return
          const transactionRef = db.collection('transactions').doc();
          transaction.set(transactionRef, {
            uid: memberId,
            groupId,
            type: 'group_deletion_refund',
            amount: amountPerMember,
            status: 'success',
            createdAt: new Date().toISOString(),
            description: 'Group deleted - funds returned'
          });
        }
      }

      // Remove group from all members' groups list
      for (const memberId of members) {
        const userRef = db.collection('users').doc(memberId);
        transaction.update(userRef, {
          groups: db.FieldValue.arrayRemove(groupId)
        });
      }

      // Delete all group invites
      const invitesRef = db.collection('invites');
      const invitesQuery = await invitesRef.where('groupId', '==', groupId).get();
      
      invitesQuery.docs.forEach(doc => {
        transaction.delete(doc.ref);
      });

      // Delete all group transactions
      const transactionsRef = db.collection('transactions');
      const transactionsQuery = await transactionsRef.where('groupId', '==', groupId).get();
      
      transactionsQuery.docs.forEach(doc => {
        transaction.delete(doc.ref);
      });

      // Finally, delete the group
      transaction.delete(groupRef);
    });

    return NextResponse.json({
      success: true,
      message: 'Group deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting group:', error);
    
    if (error.message === 'Group not found') {
      return NextResponse.json(
        { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

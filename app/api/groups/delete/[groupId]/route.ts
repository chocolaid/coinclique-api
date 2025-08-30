import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';

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

    const members = groupData.members || [];
    const currentAmount = groupData.currentAmount || 0;

    // Calculate disbursement fee (owner pays this)
    const disbursementFee = Math.round(currentAmount * 0.05); // 5% fee
    const totalDistributed = currentAmount - disbursementFee;

    // Use transaction to ensure data consistency
    await db.runTransaction(async (transaction) => {
      // Re-read group data in transaction
      const groupRef = db.collection('groups').doc(groupId);
      const groupSnap = await transaction.get(groupRef);
      const currentGroupData = groupSnap.data();
      
      if (!currentGroupData) {
        throw new Error('Group not found');
      }

      // Distribute funds back to members if there are funds
      if (totalDistributed > 0 && members.length > 0) {
        const amountPerMember = totalDistributed / members.length;
        
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
            type: 'group_disbursement',
            amount: amountPerMember,
            status: 'success',
            createdAt: new Date().toISOString(),
            description: 'Group disbanded - funds distributed'
          });
        }
      }

      // Owner pays disbursement fee
      if (disbursementFee > 0) {
        const ownerRef = db.collection('users').doc(uid);
        const ownerSnap = await transaction.get(ownerRef);
        const ownerData = ownerSnap.data();
        const ownerBalance = ownerData?.wallet?.balance || 0;
        
        transaction.update(ownerRef, {
          'wallet.balance': ownerBalance - disbursementFee
        });

        // Create transaction record for disbursement fee
        const feeRef = db.collection('transactions').doc();
        transaction.set(feeRef, {
          uid,
          groupId,
          type: 'disbursement_fee',
          amount: disbursementFee,
          status: 'success',
          createdAt: new Date().toISOString(),
          description: 'Group disbandment fee'
        });
      }

      // Remove group from all members' groups list
      for (const memberId of members) {
        const userRef = db.collection('users').doc(memberId);
        transaction.update(userRef, {
          groups: FieldValue.arrayRemove(groupId)
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

      // Update group status to disbanded instead of deleting
      transaction.update(groupRef, {
        status: 'disbanded',
        disbandedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    // Send system message to group chat
    await sendSystemMessage(groupId, 'Group has been disbanded. Funds distributed to members.', 'status_change', {
      statusChange: 'disbanded',
      disbursementFee,
      totalDistributed,
      membersRefunded: members.length
    });

    return NextResponse.json({
      success: true,
      message: 'Group disbanded successfully',
      disbursementFee,
      totalDistributed,
      membersRefunded: members.length
    });

  } catch (error) {
    console.error('Error deleting group:', error);
    
    if (error instanceof Error && error.message === 'Group not found') {
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

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    const { id: groupId } = await context.params;
    const body = await req.json();
    
    const { amount, description } = body;
    
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid amount is required', code: 'INVALID_AMOUNT' },
        { status: 400 }
      );
    }

    // Get group details
    const groupRef = db.collection('groups').doc(groupId);
    const groupDoc = await groupRef.get();
    
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
        { status: 403 }
      );
    }

    // Check if group is active
    if (groupData?.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Group is not active', code: 'GROUP_INACTIVE' },
        { status: 400 }
      );
    }

    // Validate contribution amount against group policy
    const policy = groupData.policy || {};
    if (amount < (policy.minimumContribution || 100)) {
      return NextResponse.json(
        { success: false, error: `Contribution amount must be at least ${policy.minimumContribution || 100} NGN`, code: 'BELOW_MINIMUM' },
        { status: 400 }
      );
    }

    if (amount > (policy.maximumContribution || 1000000)) {
      return NextResponse.json(
        { success: false, error: `Contribution amount cannot exceed ${policy.maximumContribution || 1000000} NGN`, code: 'ABOVE_MAXIMUM' },
        { status: 400 }
      );
    }

    // Use transaction to ensure data consistency
    await db.runTransaction(async (trx) => {
      // Re-read group and user data in transaction
      const [groupSnap, userSnap] = await Promise.all([
        trx.get(groupRef),
        trx.get(db.collection('users').doc(uid))
      ]);
      
      const g = groupSnap.data();
      const u = userSnap.data();
      
      if (!g || !u) {
        throw new Error('Group or user not found');
      }

      if (!g.members?.includes(uid)) {
        throw new Error('Not a member');
      }

      const balance = u.wallet?.balance || 0;
      if (balance < amount) {
        throw new Error('Insufficient balance');
      }

      // Check if group has reached goal
      if (g.currentAmount >= g.goalAmount) {
        throw new Error('Group has already reached its goal');
      }

      // Update user wallet
      trx.update(db.collection('users').doc(uid), {
        'wallet.balance': balance - amount
      });

      // Update group amount
      trx.update(groupRef, {
        currentAmount: (g.currentAmount || 0) + amount,
        updatedAt: new Date().toISOString()
      });

      // Create transaction record
      const transactionRef = db.collection('transactions').doc();
      trx.set(transactionRef, {
        uid,
        groupId,
        type: 'group_contribution',
        amount,
        status: 'success',
        createdAt: new Date().toISOString(),
        description: description || 'Group contribution',
        groupName: g.name
      });

      // Check if group has reached its goal
      if ((g.currentAmount || 0) + amount >= g.goalAmount) {
        trx.update(groupRef, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Contribution successful',
      amount,
      groupId
    });

  } catch (error) {
    console.error('Error processing contribution:', error);
    
    if (error.message === 'Group or user not found') {
      return NextResponse.json(
        { success: false, error: 'Group or user not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }
    
    if (error.message === 'Not a member') {
      return NextResponse.json(
        { success: false, error: 'You are not a member of this group', code: 'NOT_MEMBER' },
        { status: 403 }
      );
    }
    
    if (error.message === 'Insufficient balance') {
      return NextResponse.json(
        { success: false, error: 'Insufficient wallet balance', code: 'INSUFFICIENT_BALANCE' },
        { status: 400 }
      );
    }
    
    if (error.message === 'Group has already reached its goal') {
      return NextResponse.json(
        { success: false, error: 'Group has already reached its goal', code: 'GOAL_REACHED' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}



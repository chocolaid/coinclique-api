import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function GET(req: NextRequest, context: { params: Promise<{ groupId: string; memberId: string }> }) {
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
    const { groupId, memberId } = await context.params;

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

    // Check if memberId is a member of the group
    if (!groupData?.members?.includes(memberId)) {
      return NextResponse.json(
        { success: false, error: 'Member not found in this group', code: 'MEMBER_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get member contribution data
    const memberRef = db.collection('group_members').doc(`${groupId}_${memberId}`);
    const memberDoc = await memberRef.get();
    
    if (!memberDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Member data not found', code: 'MEMBER_DATA_NOT_FOUND' },
        { status: 404 }
      );
    }

    const memberData = memberDoc.data();

    // Get detailed contribution history
    const transactionsRef = db.collection('transactions');
    const contributionsQuery = await transactionsRef
      .where('groupId', '==', groupId)
      .where('uid', '==', memberId)
      .where('type', 'in', ['group_contribution', 'auto_save_contribution'])
      .where('status', '==', 'success')
      .orderBy('createdAt', 'desc')
      .get();

    const contributions = contributionsQuery.docs.map(doc => {
      const data = doc.data();
      return {
        transactionId: doc.id,
        amount: data.amount,
        type: data.type,
        description: data.description,
        createdAt: data.createdAt
      };
    });

    // Calculate additional statistics
    const totalContributed = memberData?.totalContributed || 0;
    const contributionCount = memberData?.contributionCount || 0;
    const lastContributionDate = memberData?.lastContributionDate || null;
    const averageContribution = contributionCount > 0 ? totalContributed / contributionCount : 0;

    // Calculate contribution frequency
    let contributionFrequency = 'none';
    if (lastContributionDate) {
      const daysSinceLastContribution = Math.floor(
        (Date.now() - new Date(lastContributionDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysSinceLastContribution <= 7) {
        contributionFrequency = 'active';
      } else if (daysSinceLastContribution <= 30) {
        contributionFrequency = 'moderate';
      } else {
        contributionFrequency = 'inactive';
      }
    }

    return NextResponse.json({
      success: true,
      contribution: totalContributed,
      contributionCount,
      lastContributionDate,
      averageContribution,
      contributionFrequency,
      contributions,
      memberStatus: memberData?.status || 'active',
      joinedAt: memberData?.joinedAt || null,
      autoSaveEnabled: memberData?.autoSaveEnabled || false,
      nextAutoSaveDate: memberData?.nextAutoSaveDate || null
    });

  } catch (error) {
    console.error('Error fetching member contribution:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

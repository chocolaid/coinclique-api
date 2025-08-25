import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function GET(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
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

    const members = groupData.members || [];
    const memberDetails = [];

    // Get detailed information for each member
    for (const memberId of members) {
      const userDoc = await db.collection('users').doc(memberId).get();
      const userData = userDoc.data();

      // Calculate member's contribution statistics
      const contributionStats = await calculateMemberContributionStats(groupId, memberId);

      memberDetails.push({
        uid: memberId,
        name: userData?.name || 'Unknown User',
        phone: userData?.phone || '',
        avatar: userData?.avatar || '',
        joinedAt: userData?.joinedAt || groupData.createdAt,
        totalContributed: contributionStats.totalContributed,
        lastContributionDate: contributionStats.lastContributionDate,
        contributionCount: contributionStats.contributionCount,
        status: contributionStats.status,
        isCreator: memberId === groupData.creator,
        averageContribution: contributionStats.contributionCount > 0 
          ? contributionStats.totalContributed / contributionStats.contributionCount 
          : 0
      });
    }

    // Sort members by total contribution (descending)
    memberDetails.sort((a, b) => b.totalContributed - a.totalContributed);

    return NextResponse.json({
      success: true,
      members: memberDetails
    });

  } catch (error) {
    console.error('Error fetching group members:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// Helper function to calculate member's contribution statistics
async function calculateMemberContributionStats(groupId: string, memberId: string) {
  const transactionsRef = db.collection('transactions');
  const contributionsQuery = await transactionsRef
    .where('groupId', '==', groupId)
    .where('uid', '==', memberId)
    .where('type', '==', 'group_contribution')
    .where('status', '==', 'success')
    .orderBy('createdAt', 'desc')
    .get();

  let totalContributed = 0;
  let lastContributionDate = null;
  let contributionCount = 0;

  contributionsQuery.docs.forEach(doc => {
    const data = doc.data();
    totalContributed += data.amount || 0;
    contributionCount++;
    
    if (!lastContributionDate || data.createdAt > lastContributionDate) {
      lastContributionDate = data.createdAt;
    }
  });

  // Determine member status based on contribution activity
  let status = 'active';
  if (contributionCount === 0) {
    status = 'inactive';
  } else if (lastContributionDate) {
    const daysSinceLastContribution = Math.floor(
      (Date.now() - new Date(lastContributionDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    if (daysSinceLastContribution > 30) {
      status = 'inactive';
    } else if (daysSinceLastContribution > 7) {
      status = 'pending';
    }
  }

  return {
    totalContributed,
    lastContributionDate,
    contributionCount,
    status
  };
}

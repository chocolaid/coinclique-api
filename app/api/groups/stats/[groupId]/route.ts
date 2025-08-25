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

    // Calculate comprehensive statistics
    const stats = await calculateGroupStats(groupId, groupData);

    return NextResponse.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Error fetching group statistics:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// Helper function to calculate comprehensive group statistics
async function calculateGroupStats(groupId: string, groupData: any) {
  const members = groupData.members || [];
  const currentAmount = groupData.currentAmount || 0;
  const goalAmount = groupData.goalAmount || 0;
  const deadline = groupData.deadline;
  const createdAt = groupData.createdAt;

  // Get all transactions for this group
  const transactionsRef = db.collection('transactions');
  const transactionsQuery = await transactionsRef
    .where('groupId', '==', groupId)
    .where('type', '==', 'group_contribution')
    .where('status', '==', 'success')
    .get();

  // Calculate contribution statistics
  let totalContributed = 0;
  let contributionCount = 0;
  let lastContributionDate = null;
  const memberContributions = new Map();

  transactionsQuery.docs.forEach(doc => {
    const data = doc.data();
    totalContributed += data.amount || 0;
    contributionCount++;
    
    if (!lastContributionDate || data.createdAt > lastContributionDate) {
      lastContributionDate = data.createdAt;
    }

    // Track individual member contributions
    const memberId = data.uid;
    const currentContribution = memberContributions.get(memberId) || 0;
    memberContributions.set(memberId, currentContribution + data.amount);
  });

  // Calculate member statistics
  const activeMembers = members.length;
  const totalMembers = members.length;
  
  // Calculate days remaining
  let daysRemaining = 0;
  if (deadline) {
    const now = new Date();
    const deadlineDate = new Date(deadline);
    daysRemaining = Math.max(0, Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  // Calculate goal progress
  const goalProgress = goalAmount > 0 ? Math.round((currentAmount / goalAmount) * 100) : 0;

  // Calculate average contribution
  const averageContribution = contributionCount > 0 ? totalContributed / contributionCount : 0;

  // Calculate completion time estimate
  let estimatedCompletionDays = 0;
  if (averageContribution > 0 && goalAmount > currentAmount) {
    const remainingAmount = goalAmount - currentAmount;
    const estimatedContributions = Math.ceil(remainingAmount / averageContribution);
    estimatedCompletionDays = Math.ceil(estimatedContributions * 30); // Assuming monthly contributions
  }

  // Calculate member activity
  const activeMemberCount = Array.from(memberContributions.keys()).length;
  const inactiveMemberCount = totalMembers - activeMemberCount;

  // Calculate contribution frequency
  const daysSinceCreation = createdAt ? 
    Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0;
  const contributionFrequency = daysSinceCreation > 0 ? contributionCount / daysSinceCreation : 0;

  // Calculate top contributors
  const topContributors = Array.from(memberContributions.entries())
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([memberId, amount]) => ({ memberId, amount }));

  // Calculate recent activity (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentTransactions = transactionsQuery.docs.filter(doc => {
    const data = doc.data();
    return new Date(data.createdAt) > thirtyDaysAgo;
  });

  const recentContributionAmount = recentTransactions.reduce((sum, doc) => {
    return sum + (doc.data().amount || 0);
  }, 0);

  const recentContributionCount = recentTransactions.length;

  return {
    totalMembers,
    activeMembers,
    inactiveMemberCount,
    totalContributed,
    goalProgress,
    daysRemaining,
    averageContribution,
    lastContributionDate,
    contributionCount,
    contributionFrequency,
    estimatedCompletionDays,
    topContributors,
    recentActivity: {
      last30Days: {
        contributionAmount: recentContributionAmount,
        contributionCount: recentContributionCount
      }
    },
    memberActivity: {
      active: activeMemberCount,
      inactive: inactiveMemberCount,
      participationRate: totalMembers > 0 ? Math.round((activeMemberCount / totalMembers) * 100) : 0
    },
    financialMetrics: {
      currentAmount,
      goalAmount,
      remainingAmount: goalAmount - currentAmount,
      averagePerMember: totalMembers > 0 ? currentAmount / totalMembers : 0
    }
  };
}

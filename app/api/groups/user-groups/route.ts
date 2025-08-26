import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function GET(req: NextRequest) {
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

    // Get user's groups
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 404 }
      );
    }

    const userData = userDoc.data();
    const userGroups = userData?.groups || [];

    if (userGroups.length === 0) {
      return NextResponse.json({
        success: true,
        groups: []
      });
    }

    // Get details for each group
    const groups = [];
    for (const groupId of userGroups) {
      const groupDoc = await db.collection('groups').doc(groupId).get();
      
      if (groupDoc.exists) {
        const groupData = groupDoc.data();
        
        if (groupData) {
          // Get last activity date
          const lastActivity = await getLastGroupActivity(groupId);
          
          groups.push({
            groupId,
            name: groupData.name,
            goalAmount: groupData.goalAmount,
            currentAmount: groupData.currentAmount || 0,
            status: groupData.status,
            members: groupData.members || [],
            isCreator: groupData.creator === uid,
            lastActivity,
            description: groupData.description,
            deadline: groupData.deadline,
            autoSave: groupData.autoSave,
            frequency: groupData.frequency
          });
        }
      }
    }

    // Sort groups by last activity (most recent first)
    groups.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

    return NextResponse.json({
      success: true,
      groups
    });

  } catch (error) {
    console.error('Error fetching user groups:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// Helper function to get the last activity date for a group
async function getLastGroupActivity(groupId: string): Promise<string> {
  try {
    // Check for recent transactions
    const transactionsRef = db.collection('transactions');
    const recentTransactionsQuery = await transactionsRef
      .where('groupId', '==', groupId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (!recentTransactionsQuery.empty) {
      const lastTransaction = recentTransactionsQuery.docs[0];
      return lastTransaction.data().createdAt;
    }

    // If no transactions, check for recent invites
    const invitesRef = db.collection('invites');
    const recentInvitesQuery = await invitesRef
      .where('groupId', '==', groupId)
      .orderBy('invitedAt', 'desc')
      .limit(1)
      .get();

    if (!recentInvitesQuery.empty) {
      const lastInvite = recentInvitesQuery.docs[0];
      return lastInvite.data().invitedAt;
    }

    // Default to group creation date
    const groupDoc = await db.collection('groups').doc(groupId).get();
    if (groupDoc.exists) {
      const groupData = groupDoc.data();
      if (groupData) {
        return groupData.createdAt;
      }
    }

    return new Date().toISOString();
  } catch (error) {
    console.error('Error getting last group activity:', error);
    return new Date().toISOString();
  }
}

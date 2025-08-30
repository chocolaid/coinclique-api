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
    const { searchParams } = new URL(req.url);
    
    const q = searchParams.get('q') || '';
    const status = searchParams.get('status') || '';
    const type = searchParams.get('type') || '';
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

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

    // Get details for each group with filtering
    const groups = [];
    for (const groupId of userGroups) {
      const groupDoc = await db.collection('groups').doc(groupId).get();
      
      if (groupDoc.exists) {
        const groupData = groupDoc.data();
        
        if (groupData) {
          // Apply filters
          let includeGroup = true;

          // Text search filter
          if (q && !groupData.name.toLowerCase().includes(q.toLowerCase()) && 
              !groupData.description?.toLowerCase().includes(q.toLowerCase())) {
            includeGroup = false;
          }

          // Status filter
          if (status && groupData.status !== status) {
            includeGroup = false;
          }

          // Type filter (strict vs flexible)
          if (type === 'strict' && !groupData.policy?.strictContribution) {
            includeGroup = false;
          } else if (type === 'flexible' && groupData.policy?.strictContribution) {
            includeGroup = false;
          }

          if (includeGroup) {
            // Get last activity date
            const lastActivity = await getLastGroupActivity(groupId);
            
            groups.push({
              groupId,
              name: groupData.name,
              status: groupData.status,
              goalAmount: groupData.goalAmount,
              currentAmount: groupData.currentAmount || 0,
              members: groupData.members || [],
              isCreator: groupData.creator === uid,
              lastActivity,
              description: groupData.description,
              deadline: groupData.deadline,
              autoSave: groupData.autoSave,
              frequency: groupData.frequency,
              policy: groupData.policy
            });
          }
        }
      }
    }

    // Sort groups by relevance and activity
    groups.sort((a, b) => {
      // First sort by last activity (most recent first)
      const activityDiff = new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      if (activityDiff !== 0) return activityDiff;
      
      // Then by name for consistent ordering
      return a.name.localeCompare(b.name);
    });

    // Apply pagination
    const paginatedGroups = groups.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      groups: paginatedGroups,
      total: groups.length,
      hasMore: offset + limit < groups.length
    });

  } catch (error) {
    console.error('Error searching groups:', error);
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

    // If no transactions, check for recent messages
    const messagesRef = db.collection('group_messages');
    const recentMessagesQuery = await messagesRef
      .where('groupId', '==', groupId)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    if (!recentMessagesQuery.empty) {
      const lastMessage = recentMessagesQuery.docs[0];
      return lastMessage.data().timestamp;
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

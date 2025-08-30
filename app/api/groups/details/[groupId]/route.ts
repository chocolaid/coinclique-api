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

    // Get member details with contribution information
    const memberDetails = await Promise.all(
      groupData.members.map(async (memberId: string) => {
        const userDoc = await db.collection('users').doc(memberId).get();
        const userData = userDoc.data();
        
        // Get member contribution data
        const memberDoc = await db.collection('group_members').doc(`${groupId}_${memberId}`).get();
        const memberData = memberDoc.data();
        
        return {
          uid: memberId,
          name: userData?.name || 'Unknown User',
          phone: userData?.phone || '',
          avatar: userData?.avatar || '',
          joinedAt: memberData?.joinedAt || groupData.createdAt,
          totalContributed: memberData?.totalContributed || 0,
          lastContributionDate: memberData?.lastContributionDate || null,
          contributionCount: memberData?.contributionCount || 0,
          status: memberData?.status || 'active'
        };
      })
    );

    const response = {
      success: true,
      group: {
        groupId,
        name: groupData.name,
        description: groupData.description,
        goalAmount: groupData.goalAmount,
        currentAmount: groupData.currentAmount || 0,
        members: memberDetails,
        status: groupData.status,
        autoSave: groupData.autoSave,
        frequency: groupData.frequency,
        autoSaveAmount: groupData.autoSaveAmount,
        autoSaveDay: groupData.autoSaveDay,
        deadline: groupData.deadline,
        chatId: groupData.chatId,
        inviteCode: groupData.inviteCode,
        policy: groupData.policy,
        createdAt: groupData.createdAt,
        updatedAt: groupData.updatedAt,
        creator: groupData.creator
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching group details:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

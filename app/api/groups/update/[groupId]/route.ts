import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { notificationService } from '@/lib/notifications';

export async function PUT(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
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
    const body = await req.json();

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
        { success: false, error: 'Only group creator can update group', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Validate updates
    const { name, description, goalAmount } = body;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = {};

    if (name !== undefined) {
      if (name.length < 3 || name.length > 50) {
        return NextResponse.json(
          { success: false, error: 'Group name must be between 3 and 50 characters', code: 'INVALID_NAME' },
          { status: 400 }
        );
      }
      updates.name = name;
    }

    if (description !== undefined) {
      updates.description = description;
    }

    if (goalAmount !== undefined) {
      if (goalAmount < 1000 || goalAmount > 10000000) {
        return NextResponse.json(
          { success: false, error: 'Goal amount must be between 1,000 and 10,000,000 NGN', code: 'INVALID_GOAL_AMOUNT' },
          { status: 400 }
        );
      }
      updates.goalAmount = goalAmount;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid updates provided', code: 'NO_UPDATES' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();

    // Update group
    await db.collection('groups').doc(groupId).update(updates);

    // Send notification to all group members about group update
    if (groupData.members && groupData.members.length > 0) {
      try {
        const updatedFields = Object.keys(updates).filter(key => key !== 'updatedAt');
        let updateMessage = 'Group information has been updated';
        
        if (updates.name) {
          updateMessage = `Group name changed to "${updates.name}"`;
        } else if (updates.goalAmount) {
          updateMessage = `Group goal amount updated to ₦${updates.goalAmount.toLocaleString()}`;
        } else if (updates.description) {
          updateMessage = 'Group description has been updated';
        }

        await notificationService.sendBatchNotification(groupData.members, {
          type: 'group_updated',
          title: 'Group Updated',
          message: updateMessage,
          category: 'group',
          priority: 'normal',
          data: {
            groupId,
            groupName: groupData.name,
            updatedFields,
            updatedBy: uid,
            timestamp: new Date().toISOString()
          },
          actionUrl: `/groups/${groupId}`,
        });
      } catch (notificationError) {
        console.error('Error sending group update notification:', notificationError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Group updated successfully'
    });

  } catch (error) {
    console.error('Error updating group:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

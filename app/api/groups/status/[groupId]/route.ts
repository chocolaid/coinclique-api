import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function POST(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
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

    const { action } = body;
    
    if (!action || !['pause', 'resume'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Use "pause" or "resume"', code: 'INVALID_ACTION' },
        { status: 400 }
      );
    }

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
        { success: false, error: 'Only group creator can change group status', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    let newStatus: string;
    let message: string;

    if (action === 'pause') {
      // Check if group can be paused
      if (groupData?.status === 'paused') {
        return NextResponse.json(
          { success: false, error: 'Group is already paused', code: 'ALREADY_PAUSED' },
          { status: 400 }
        );
      }

      if (groupData?.status === 'completed') {
        return NextResponse.json(
          { success: false, error: 'Cannot pause completed group', code: 'CANNOT_PAUSE_COMPLETED' },
          { status: 400 }
        );
      }

      newStatus = 'paused';
      message = 'Group paused successfully';
    } else {
      // action === 'resume'
      if (groupData?.status !== 'paused') {
        return NextResponse.json(
          { success: false, error: 'Group is not paused', code: 'NOT_PAUSED' },
          { status: 400 }
        );
      }

      // Check if group meets minimum member requirement
      if (groupData?.members?.length < groupData?.policy?.minMembers) {
        return NextResponse.json(
          { success: false, error: 'Cannot resume group. Minimum member requirement not met.', code: 'MIN_MEMBERS_REQUIRED' },
          { status: 400 }
        );
      }

      newStatus = 'active';
      message = 'Group resumed successfully';
    }

    // Update group status
    await db.collection('groups').doc(groupId).update({
      status: newStatus,
      updatedAt: new Date().toISOString()
    });

    // Create activity log
    await db.collection('group_activities').add({
      groupId,
      action: `status_${action}`,
      performedBy: uid,
      oldStatus: groupData.status,
      newStatus,
      timestamp: new Date().toISOString(),
      details: {
        reason: action === 'pause' ? 'Group paused by creator' : 'Group resumed by creator'
      }
    });

    return NextResponse.json({
      success: true,
      message,
      newStatus
    });

  } catch (error) {
    console.error('Error changing group status:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

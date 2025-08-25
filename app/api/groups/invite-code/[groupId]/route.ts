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

    // Check if group allows member addition
    if (groupData?.policy?.allowMemberAddition === false) {
      return NextResponse.json(
        { success: false, error: 'Group does not allow new members', code: 'MEMBER_ADDITION_DISABLED' },
        { status: 400 }
      );
    }

    // Check if group is full
    if (groupData?.members?.length >= groupData?.policy?.maxMembers) {
      return NextResponse.json(
        { success: false, error: 'Group has reached maximum member limit', code: 'GROUP_FULL' },
        { status: 400 }
      );
    }

    // Generate new invite code
    const newInviteCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    
    // Update group with new invite code
    await db.collection('groups').doc(groupId).update({
      inviteCode: newInviteCode,
      updatedAt: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      inviteCode: newInviteCode,
      message: 'Invite code generated successfully'
    });

  } catch (error) {
    console.error('Error generating invite code:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

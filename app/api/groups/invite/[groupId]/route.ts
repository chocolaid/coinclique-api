import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { notificationService } from '@/lib/notifications';
import { notificationTemplates } from '@/lib/notification-templates';

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

    const { phoneNumber } = body;
    
    if (!phoneNumber) {
      return NextResponse.json(
        { success: false, error: 'Phone number is required', code: 'MISSING_PHONE' },
        { status: 400 }
      );
    }

    // Validate Nigerian phone number format
    const phoneRegex = /^\+234[0-9]{10}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return NextResponse.json(
        { success: false, error: 'Invalid phone number format. Use +234XXXXXXXXXX', code: 'INVALID_PHONE' },
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

    // Find user by phone number
    const usersRef = db.collection('users');
    const userQuery = await usersRef.where('phone', '==', phoneNumber).limit(1).get();
    
    if (userQuery.empty) {
      return NextResponse.json(
        { success: false, error: 'User not found with this phone number', code: 'USER_NOT_FOUND' },
        { status: 404 }
      );
    }

    const userDoc = userQuery.docs[0];
    const invitedUserId = userDoc.id;

    // Check if user is already a member
    if (groupData?.members?.includes(invitedUserId)) {
      return NextResponse.json(
        { success: false, error: 'User is already a member of this group', code: 'ALREADY_MEMBER' },
        { status: 400 }
      );
    }

    // Check if invitation already exists
    const invitesRef = db.collection('invites');
    const existingInviteQuery = await invitesRef
      .where('groupId', '==', groupId)
      .where('userId', '==', invitedUserId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingInviteQuery.empty) {
      return NextResponse.json(
        { success: false, error: 'Invitation already sent to this user', code: 'INVITATION_EXISTS' },
        { status: 400 }
      );
    }

    // Create invitation
    const inviteData = {
      groupId,
      userId: invitedUserId,
      invitedBy: uid,
      status: 'pending',
      invitedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days expiry
    };

    const inviteRef = await invitesRef.add(inviteData);

    // Get inviter's name for the notification
    const inviterDoc = await db.collection('users').doc(uid).get();
    const inviterData = inviterDoc.data();
    const inviterName = inviterData?.name || 'A group member';

    // Send notification to invited user
    try {
      await notificationService.sendNotification(invitedUserId, notificationTemplates.group_invite({
        groupId,
        groupName: groupData.name,
        invitedBy: uid,
        invitedByName: inviterName,
        expiresAt: inviteData.expiresAt
      }));
    } catch (notificationError) {
      console.error('Error sending invitation notification:', notificationError);
      // Don't fail the entire request if notification fails
    }

    return NextResponse.json({
      success: true,
      inviteId: inviteRef.id,
      message: 'Invitation sent successfully'
    });

  } catch (error) {
    console.error('Error sending invitation:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

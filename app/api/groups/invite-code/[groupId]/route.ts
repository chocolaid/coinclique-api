import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { notificationService } from '@/lib/notifications';

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
    
    const { expiryDays, maxUses } = body || {};

    // Get group details
    const groupDoc = await db.collection('groups').doc(groupId).get();
    
    if (!groupDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
        { status: 404 }
      );
    }

    const groupData = groupDoc.data();
    
    // Check if user is the group creator
    if (groupData?.creator !== uid) {
      return NextResponse.json(
        { success: false, error: 'Only group creator can generate invite codes', code: 'INSUFFICIENT_PERMISSIONS' },
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
    
    // Calculate expiry date
    const expiresAt = expiryDays ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString() : null;
    
    // Create invite code document
    const inviteData = {
      inviteId: `invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      groupId,
      inviteCode: newInviteCode,
      invitedBy: uid,
      expiresAt,
      maxUses: maxUses || null,
      currentUses: 0,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    
    // Store invite code in group_invites collection
    await db.collection('group_invites').add(inviteData);
    
    // Update group with new invite code
    await db.collection('groups').doc(groupId).update({
      inviteCode: newInviteCode,
      updatedAt: new Date().toISOString()
    });

    // Send notification to all group members about new invite code
    if (groupData.members && groupData.members.length > 0) {
      try {
        const expiryText = expiryDays ? ` (expires in ${expiryDays} days)` : '';
        const maxUsesText = maxUses ? ` (max ${maxUses} uses)` : '';

        await notificationService.sendBatchNotification(groupData.members, {
          type: 'invite_code_generated',
          title: 'New Invite Code Generated',
          message: `New invite code generated for ${groupData.name}${expiryText}${maxUsesText}`,
          category: 'group',
          priority: 'normal',
          data: {
            groupId,
            groupName: groupData.name,
            inviteCode: newInviteCode,
            expiresAt,
            maxUses,
            generatedBy: uid,
            timestamp: new Date().toISOString()
          },
          actionUrl: `/groups/${groupId}/invite`,
        });
      } catch (notificationError) {
        console.error('Error sending invite code notification:', notificationError);
      }
    }

    return NextResponse.json({
      success: true,
      inviteCode: newInviteCode,
      expiresAt,
      maxUses: maxUses || null,
      currentUses: 0,
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

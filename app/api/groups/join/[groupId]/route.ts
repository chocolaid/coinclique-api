import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';

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

    const { inviteCode } = body;
    
    if (!inviteCode) {
      return NextResponse.json(
        { success: false, error: 'Invite code is required', code: 'MISSING_INVITE_CODE' },
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
    
    // Check if group is active
    if (groupData?.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Group is not active', code: 'GROUP_INACTIVE' },
        { status: 400 }
      );
    }

    // Check if user is already a member
    if (groupData?.members?.includes(uid)) {
      return NextResponse.json(
        { success: false, error: 'You are already a member of this group', code: 'ALREADY_MEMBER' },
        { status: 400 }
      );
    }

    // Verify invite code
    if (groupData?.inviteCode !== inviteCode) {
      return NextResponse.json(
        { success: false, error: 'Invalid invite code', code: 'INVALID_INVITE_CODE' },
        { status: 400 }
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

    // Use transaction to ensure data consistency
    await db.runTransaction(async (transaction) => {
      // Re-read group data in transaction
      const groupRef = db.collection('groups').doc(groupId);
      const groupSnap = await transaction.get(groupRef);
      const currentGroupData = groupSnap.data();
      
      if (!currentGroupData) {
        throw new Error('Group not found');
      }

      // Double-check member limit in transaction
      if (currentGroupData.members && currentGroupData.members.length >= currentGroupData.policy?.maxMembers) {
        throw new Error('Group is full');
      }

      // Add user to group
      transaction.update(groupRef, {
        members: FieldValue.arrayUnion(uid),
        updatedAt: new Date().toISOString()
      });

      // Add group to user's groups
      const userRef = db.collection('users').doc(uid);
      transaction.update(userRef, {
        groups: FieldValue.arrayUnion(groupId)
      });

      // Update or create invitation status
      const invitesRef = db.collection('invites');
      const inviteQuery = await invitesRef
        .where('groupId', '==', groupId)
        .where('userId', '==', uid)
        .limit(1)
        .get();

      if (!inviteQuery.empty) {
        const inviteDoc = inviteQuery.docs[0];
        transaction.update(inviteDoc.ref, {
          status: 'accepted',
          acceptedAt: new Date().toISOString()
        });
      } else {
        // Create invitation record if none exists
        transaction.set(invitesRef.doc(), {
          groupId,
          userId: uid,
          invitedBy: 'self',
          status: 'accepted',
          invitedAt: new Date().toISOString(),
          acceptedAt: new Date().toISOString()
        });
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Successfully joined group'
    });

  } catch (error) {
    console.error('Error joining group:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Group not found') {
        return NextResponse.json(
          { success: false, error: 'Group not found', code: 'GROUP_NOT_FOUND' },
          { status: 404 }
        );
      }
      
      if (error.message === 'Group is full') {
        return NextResponse.json(
          { success: false, error: 'Group has reached maximum member limit', code: 'GROUP_FULL' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

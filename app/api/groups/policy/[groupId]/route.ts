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
    } catch {
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
        { success: false, error: 'Only group creator can update policy', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Check if group is active
    if (groupData?.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Cannot update policy for inactive group', code: 'GROUP_INACTIVE' },
        { status: 400 }
      );
    }

    const { policy } = body;
    
    if (!policy || typeof policy !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid policy data', code: 'INVALID_POLICY' },
        { status: 400 }
      );
    }

    // Validate policy updates
    const updates: Record<string, unknown> = {};
    const currentPolicy = groupData.policy || {};

    // Member limits validation
    if (policy.minMembers !== undefined) {
      if (policy.minMembers < 2 || policy.minMembers > 20) {
        return NextResponse.json(
          { success: false, error: 'Minimum members must be between 2 and 20', code: 'INVALID_POLICY' },
          { status: 400 }
        );
      }
      updates['policy.minMembers'] = policy.minMembers;
    }

    if (policy.maxMembers !== undefined) {
      if (policy.maxMembers < 2 || policy.maxMembers > 20) {
        return NextResponse.json(
          { success: false, error: 'Maximum members must be between 2 and 20', code: 'INVALID_POLICY' },
          { status: 400 }
        );
      }
      updates['policy.maxMembers'] = policy.maxMembers;
    }

    // Check if new member limits conflict with current member count
    const newMinMembers = policy.minMembers !== undefined ? policy.minMembers : currentPolicy.minMembers;
    const newMaxMembers = policy.maxMembers !== undefined ? policy.maxMembers : currentPolicy.maxMembers;
    
    if (newMinMembers > newMaxMembers) {
      return NextResponse.json(
        { success: false, error: 'Minimum members cannot exceed maximum members', code: 'INVALID_POLICY' },
        { status: 400 }
      );
    }

    if (groupData.members && groupData.members.length > newMaxMembers) {
      return NextResponse.json(
        { success: false, error: 'Cannot set maximum members below current member count', code: 'INVALID_POLICY' },
        { status: 400 }
      );
    }

    // Other policy validations
    if (policy.earlyWithdrawalPenalty !== undefined) {
      if (policy.earlyWithdrawalPenalty < 0 || policy.earlyWithdrawalPenalty > 100) {
        return NextResponse.json(
          { success: false, error: 'Early withdrawal penalty must be between 0 and 100', code: 'INVALID_POLICY' },
          { status: 400 }
        );
      }
      updates['policy.earlyWithdrawalPenalty'] = policy.earlyWithdrawalPenalty;
    }

    if (policy.lateContributionPenalty !== undefined) {
      if (policy.lateContributionPenalty < 0 || policy.lateContributionPenalty > 100) {
        return NextResponse.json(
          { success: false, error: 'Late contribution penalty must be between 0 and 100', code: 'INVALID_POLICY' },
          { status: 400 }
        );
      }
      updates['policy.lateContributionPenalty'] = policy.lateContributionPenalty;
    }

    if (policy.minimumContribution !== undefined) {
      if (policy.minimumContribution < 100 || policy.minimumContribution > 100000) {
        return NextResponse.json(
          { success: false, error: 'Minimum contribution must be between 100 and 100,000 NGN', code: 'INVALID_POLICY' },
          { status: 400 }
        );
      }
      updates['policy.minimumContribution'] = policy.minimumContribution;
    }

    if (policy.maximumContribution !== undefined) {
      if (policy.maximumContribution < 1000 || policy.maximumContribution > 1000000) {
        return NextResponse.json(
          { success: false, error: 'Maximum contribution must be between 1,000 and 1,000,000 NGN', code: 'INVALID_POLICY' },
          { status: 400 }
        );
      }
      updates['policy.maximumContribution'] = policy.maximumContribution;
    }

    // Boolean policy updates
    const booleanFields = [
      'allowEarlyWithdrawal', 'deadlineExtensionAllowed', 'allowMemberRemoval',
      'allowMemberAddition', 'autoSaveEnabled'
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booleanFields.forEach((field: any) => {
      if (policy[field] !== undefined) {
        updates[`policy.${field}`] = policy[field];
      }
    });

    // String policy updates
    const stringFields = ['contributionAmount', 'distributionMethod', 'autoSaveFrequency'];
    stringFields.forEach(field => {
      if (policy[field] !== undefined) {
        updates[`policy.${field}`] = policy[field];
      }
    });

    // Numeric policy updates
    const numericFields = [
      'minimumContributionPeriod', 'maximumContributionPeriod', 'fixedAmount',
      'maxDeadlineExtensions', 'deadlineExtensionDays', 'earlyCompletionBonus',
      'inactivityPenalty'
    ];

    numericFields.forEach(field => {
      if (policy[field] !== undefined) {
        if (typeof policy[field] === 'number' && policy[field] >= 0) {
          updates[`policy.${field}`] = policy[field];
        }
      }
    });

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid policy updates provided', code: 'NO_UPDATES' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();

    // Update group policy
    await db.collection('groups').doc(groupId).update(updates);

    // Send notification to all group members about policy update
    if (groupData.members && groupData.members.length > 0) {
      try {
        const updatedFields = Object.keys(updates).filter(key => key !== 'updatedAt');
        const policyMessage = `Group policy has been updated: ${updatedFields.join(', ')}`;

        await notificationService.sendBatchNotification(groupData.members, {
          type: 'policy_updated',
          title: 'Group Policy Updated',
          message: policyMessage,
          category: 'group',
          priority: 'normal',
          data: {
            groupId,
            groupName: groupData.name,
            updatedFields,
            updatedBy: uid,
            timestamp: new Date().toISOString()
          },
          actionUrl: `/groups/${groupId}/settings`,
        });
      } catch (notificationError) {
        console.error('Error sending policy update notification:', notificationError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Policy updated successfully'
    });

  } catch (error) {
    console.error('Error updating group policy:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

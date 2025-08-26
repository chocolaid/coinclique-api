import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
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
    const body = await req.json();
    
    // Validate required fields
    const { name, description, goalAmount, autoSave, frequency, autoSaveAmount, autoSaveDay, policy } = body;
    
    if (!name || !goalAmount || !policy) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields', code: 'MISSING_FIELDS' },
        { status: 400 }
      );
    }

    // Validate group name
    if (name.length < 3 || name.length > 50) {
      return NextResponse.json(
        { success: false, error: 'Group name must be between 3 and 50 characters', code: 'INVALID_NAME' },
        { status: 400 }
      );
    }

    // Validate goal amount
    if (goalAmount < 1000 || goalAmount > 10000000) {
      return NextResponse.json(
        { success: false, error: 'Goal amount must be between 1,000 and 10,000,000 NGN', code: 'INVALID_GOAL_AMOUNT' },
        { status: 400 }
      );
    }

    // Validate policy
    if (policy.minMembers < 2 || policy.maxMembers > 20 || policy.minMembers > policy.maxMembers) {
      return NextResponse.json(
        { success: false, error: 'Invalid member limits', code: 'INVALID_POLICY' },
        { status: 400 }
      );
    }

    // Create group document
    const groupData = {
      name,
      description: description || '',
      goalAmount,
      currentAmount: 0,
      members: [uid],
      creator: uid,
      status: 'active',
      autoSave: autoSave || false,
      frequency: frequency || 'monthly',
      autoSaveAmount: autoSaveAmount || 0,
      autoSaveDay: autoSaveDay || 1,
      deadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year default
      chatId: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      inviteCode: Math.random().toString(36).substr(2, 6).toUpperCase(),
      policy: {
        allowEarlyWithdrawal: policy.allowEarlyWithdrawal || false,
        earlyWithdrawalPenalty: policy.earlyWithdrawalPenalty || 10,
        minimumContributionPeriod: policy.minimumContributionPeriod || 30,
        maximumContributionPeriod: policy.maximumContributionPeriod || 365,
        contributionAmount: policy.contributionAmount || 'fixed',
        fixedAmount: policy.fixedAmount || 0,
        minimumContribution: policy.minimumContribution || 1000,
        maximumContribution: policy.maximumContribution || 100000,
        deadlineExtensionAllowed: policy.deadlineExtensionAllowed || false,
        maxDeadlineExtensions: policy.maxDeadlineExtensions || 0,
        deadlineExtensionDays: policy.deadlineExtensionDays || 0,
        allowMemberRemoval: policy.allowMemberRemoval || false,
        allowMemberAddition: policy.allowMemberAddition || true,
        maxMembers: policy.maxMembers || 10,
        minMembers: policy.minMembers || 2,
        distributionMethod: policy.distributionMethod || 'equal',
        lateContributionPenalty: policy.lateContributionPenalty || 5,
        earlyCompletionBonus: policy.earlyCompletionBonus || 2,
        inactivityPenalty: policy.inactivityPenalty || 7,
        autoSaveEnabled: policy.autoSaveEnabled || false,
        autoSaveFrequency: policy.autoSaveFrequency || 'monthly'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const groupRef = await db.collection('groups').add(groupData);
    
    // Add user to group members
    await db.collection('users').doc(uid).update({
      groups: FieldValue.arrayUnion(groupRef.id)
    });

    return NextResponse.json({
      success: true,
      groupId: groupRef.id,
      chatId: groupData.chatId,
      inviteCode: groupData.inviteCode,
      message: 'Group created successfully'
    });

  } catch (error) {
    console.error('Error creating group:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

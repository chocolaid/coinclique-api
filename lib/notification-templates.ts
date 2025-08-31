import { NotificationData } from './notifications';

// Notification templates for consistent messaging
export const notificationTemplates = {
  // Payment notifications
  payment_success: (data: { amount: number; reference: string; cardLast4?: string }): NotificationData => ({
    type: 'payment_success',
    title: 'Payment Successful',
    message: `Payment of ₦${data.amount.toLocaleString()} was successful`,
    category: 'payment',
    priority: 'normal',
    data: {
      amount: data.amount,
      reference: data.reference,
      paymentMethod: 'card',
      ...(data.cardLast4 && { cardLast4: data.cardLast4 })
    },
    actionUrl: `/transactions/${data.reference}`,
  }),

  payment_failed: (data: { amount: number; reference: string; errorMessage: string }): NotificationData => ({
    type: 'payment_failed',
    title: 'Payment Failed',
    message: `Payment of ₦${data.amount.toLocaleString()} failed - please retry`,
    category: 'payment',
    priority: 'high',
    data: {
      amount: data.amount,
      reference: data.reference,
      paymentMethod: 'card',
      errorMessage: data.errorMessage
    },
    actionUrl: `/transactions/${data.reference}`,
  }),

  withdrawal_success: (data: { amount: number; reference: string; bankAccount: string }): NotificationData => ({
    type: 'withdrawal_success',
    title: 'Withdrawal Successful',
    message: `Withdrawal of ₦${data.amount.toLocaleString()} was successful`,
    category: 'payment',
    priority: 'normal',
    data: {
      amount: data.amount,
      reference: data.reference,
      bankAccount: data.bankAccount
    },
    actionUrl: `/transactions/${data.reference}`,
  }),

  withdrawal_failed: (data: { amount: number; reference: string; bankAccount: string }): NotificationData => ({
    type: 'withdrawal_failed',
    title: 'Withdrawal Failed',
    message: `Withdrawal of ₦${data.amount.toLocaleString()} failed - funds returned to wallet`,
    category: 'payment',
    priority: 'high',
    data: {
      amount: data.amount,
      reference: data.reference,
      bankAccount: data.bankAccount
    },
    actionUrl: `/transactions/${data.reference}`,
  }),

  // Group notifications
  group_created: (data: { groupId: string; groupName: string; goalAmount: number; inviteCode: string }): NotificationData => ({
    type: 'group_created',
    title: 'Group Created Successfully',
    message: `Your group "${data.groupName}" has been created successfully`,
    category: 'group',
    priority: 'normal',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      goalAmount: data.goalAmount,
      inviteCode: data.inviteCode
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  group_joined: (data: { groupId: string; groupName: string; memberCount: number; goalAmount: number }): NotificationData => ({
    type: 'group_joined',
    title: 'Welcome to the Group!',
    message: `You've successfully joined ${data.groupName}`,
    category: 'group',
    priority: 'normal',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      memberCount: data.memberCount,
      goalAmount: data.goalAmount
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  member_joined: (data: { groupId: string; groupName: string; memberCount: number }): NotificationData => ({
    type: 'member_joined',
    title: 'New Member Joined',
    message: `A new member joined ${data.groupName}`,
    category: 'group',
    priority: 'normal',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      memberCount: data.memberCount
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  member_left: (data: { groupId: string; groupName: string; userId: string; userName: string; memberCount: number; reason?: string }): NotificationData => ({
    type: 'member_left',
    title: 'Member Left Group',
    message: `${data.userName} left ${data.groupName}`,
    category: 'group',
    priority: 'normal',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      userId: data.userId,
      userName: data.userName,
      memberCount: data.memberCount,
      ...(data.reason && { reason: data.reason })
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  group_invite: (data: { groupId: string; groupName: string; invitedBy: string; invitedByName: string; inviteCode?: string; expiresAt?: string }): NotificationData => ({
    type: 'group_invite',
    title: 'Group Invitation',
    message: `You've been invited to join ${data.groupName} by ${data.invitedByName}`,
    category: 'group',
    priority: 'normal',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      invitedBy: data.invitedBy,
      invitedByName: data.invitedByName,
      ...(data.inviteCode && { inviteCode: data.inviteCode }),
      ...(data.expiresAt && { expiresAt: data.expiresAt })
    },
    actionUrl: `/groups/invite/${data.groupId}?inviteCode?${data.inviteCode}`,
  }),

  contribution_made: (data: { groupId: string; groupName: string; amount: number; totalContributed: number; goalProgress: number }): NotificationData => ({
    type: 'contribution_made',
    title: 'New Contribution',
    message: `A member contributed ₦${data.amount.toLocaleString()} to ${data.groupName}`,
    category: 'group',
    priority: 'normal',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      amount: data.amount,
      totalContributed: data.totalContributed,
      goalProgress: data.goalProgress
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  group_goal_reached: (data: { groupId: string; groupName: string; goalAmount: number; currentAmount: number; memberCount: number }): NotificationData => ({
    type: 'group_goal_reached',
    title: 'Goal Reached!',
    message: `Congratulations! ${data.groupName} has reached its goal of ₦${data.goalAmount.toLocaleString()}`,
    category: 'group',
    priority: 'high',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      goalAmount: data.goalAmount,
      currentAmount: data.currentAmount,
      memberCount: data.memberCount
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  group_disbanded: (data: { groupId: string; groupName: string; totalDistributed: number; memberCount: number; disbursementFee: number }): NotificationData => ({
    type: 'group_disbanded',
    title: 'Group Disbanded',
    message: `${data.groupName} has been disbanded. Funds distributed to members.`,
    category: 'group',
    priority: 'high',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      totalDistributed: data.totalDistributed,
      memberCount: data.memberCount,
      disbursementFee: data.disbursementFee
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  auto_save_failed: (data: { groupId: string; groupName: string; amount: number; errorMessage: string }): NotificationData => ({
    type: 'auto_save_failed',
    title: 'Auto-Save Failed',
    message: `Auto-save of ₦${data.amount.toLocaleString()} failed for ${data.groupName}. Please check your card.`,
    category: 'group',
    priority: 'high',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      amount: data.amount,
      errorMessage: data.errorMessage
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  penalty_applied: (data: { groupId: string; groupName: string; amount: number; reason: string; penaltyType: string; newBalance: number }): NotificationData => ({
    type: 'penalty_applied',
    title: 'Penalty Applied',
    message: `Penalty of ₦${data.amount.toLocaleString()} applied for ${data.reason}`,
    category: 'group',
    priority: 'high',
    data: {
      groupId: data.groupId,
      groupName: data.groupName,
      amount: data.amount,
      reason: data.reason,
      penaltyType: data.penaltyType,
      newBalance: data.newBalance
    },
    actionUrl: `/groups/${data.groupId}`,
  }),

  // Security notifications
  login_alert: (data: { location: string; deviceType: string; ipAddress: string; isSuspicious: boolean }): NotificationData => ({
    type: 'login_alert',
    title: 'New Login Detected',
    message: `New login from ${data.location} on ${data.deviceType}`,
    category: 'security',
    priority: 'high',
    data: {
      location: data.location,
      deviceType: data.deviceType,
      ipAddress: data.ipAddress,
      isSuspicious: data.isSuspicious
    },
    actionUrl: '/settings/security',
  }),

  // System notifications
  app_update: (data: { version: string; features: string[]; isRequired: boolean }): NotificationData => ({
    type: 'app_update',
    title: 'App Update Available',
    message: 'A new version of CoinClique is available with new features',
    category: 'system',
    priority: 'normal',
    data: {
      version: data.version,
      features: data.features,
      isRequired: data.isRequired
    },
    actionUrl: '/settings/app-update',
  }),

  maintenance: (data: { startTime: string; endTime: string; duration: number; reason: string }): NotificationData => ({
    type: 'maintenance',
    title: 'Scheduled Maintenance',
    message: 'CoinClique will be unavailable for maintenance',
    category: 'system',
    priority: 'high',
    data: {
      startTime: data.startTime,
      endTime: data.endTime,
      duration: data.duration,
      reason: data.reason
    },
    actionUrl: '/maintenance',
  }),
};

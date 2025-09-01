# CoinClique Notification Types Reference

## Overview
This document provides a comprehensive reference for all notification types used in the CoinClique application. Each notification type includes its data structure, trigger conditions, and example implementations.

## Notification Categories

### 1. Payment Notifications
Notifications related to financial transactions, card management, and wallet operations.

#### `payment_success`
**Trigger**: Successful payment/charge
**Priority**: Normal
**Category**: Payment

```ts
{
  type: 'payment_success',
  title: 'Payment Successful',
  message: `Payment of ₦${amount} was successful`,
  category: 'payment',
  priority: 'normal',
  data: {
    amount: number,
    reference: string,
    paymentMethod: 'card' | 'bank_transfer',
    cardLast4?: string,
    bankAccount?: string,
  },
  actionUrl: `/transactions/${reference}`,
}
```

#### `payment_failed`
**Trigger**: Failed payment/charge
**Priority**: High
**Category**: Payment

```ts
{
  type: 'payment_failed',
  title: 'Payment Failed',
  message: `Payment of ₦${amount} failed - please retry`,
  category: 'payment',
  priority: 'high',
  data: {
    amount: number,
    reference: string,
    paymentMethod: 'card' | 'bank_transfer',
    errorCode: string,
    errorMessage: string,
  },
  actionUrl: `/transactions/${reference}`,
}
```

#### `card_linked`
**Trigger**: Card successfully linked to account
**Priority**: Normal
**Category**: Payment

```ts
{
  type: 'card_linked',
  title: 'Card Successfully Linked',
  message: `Card ending in ${last4} has been linked to your account`,
  category: 'payment',
  priority: 'normal',
  data: {
    cardLast4: string,
    cardBrand: 'visa' | 'mastercard' | 'verve',
    cardType: 'debit' | 'credit',
  },
  actionUrl: '/settings/cards',
}
```

#### `card_expired`
**Trigger**: Card expiration detected
**Priority**: High
**Category**: Payment

```ts
{
  type: 'card_expired',
  title: 'Card Expired',
  message: `Your card ending in ${last4} has expired. Please update it.`,
  category: 'payment',
  priority: 'high',
  data: {
    cardLast4: string,
    cardBrand: string,
    expiryDate: string,
  },
  actionUrl: '/settings/cards',
}
```

#### `low_balance`
**Trigger**: Wallet balance below threshold
**Priority**: Normal
**Category**: Payment

```ts
{
  type: 'low_balance',
  title: 'Low Wallet Balance',
  message: `Your wallet balance is ₦${balance}. Consider topping up.`,
  category: 'payment',
  priority: 'normal',
  data: {
    currentBalance: number,
    threshold: number,
  },
  actionUrl: '/wallet/topup',
}
```

#### `withdrawal_success`
**Trigger**: Successful withdrawal to bank
**Priority**: Normal
**Category**: Payment

```ts
{
  type: 'withdrawal_success',
  title: 'Withdrawal Successful',
  message: `Withdrawal of ₦${amount} to ${bankName} was successful`,
  category: 'payment',
  priority: 'normal',
  data: {
    amount: number,
    bankName: string,
    accountNumber: string,
    reference: string,
  },
  actionUrl: `/transactions/${reference}`,
}
```

#### `withdrawal_failed`
**Trigger**: Failed withdrawal
**Priority**: High
**Category**: Payment

```ts
{
  type: 'withdrawal_failed',
  title: 'Withdrawal Failed',
  message: `Withdrawal of ₦${amount} failed - funds returned to wallet`,
  category: 'payment',
  priority: 'high',
  data: {
    amount: number,
    bankName: string,
    accountNumber: string,
    reference: string,
    errorCode: string,
    errorMessage: string,
  },
  actionUrl: `/transactions/${reference}`,
}
```

### 2. Group Notifications
Notifications related to group activities, member management, and contributions.

#### `group_invite`
**Trigger**: User receives direct group invitation (via phone number)
**Priority**: Normal
**Category**: Group

```ts
{
  type: 'group_invite',
  title: 'Group Invitation',
  message: `You've been invited to join ${groupName} by ${invitedByName}`,
  category: 'group',
  priority: 'normal',
  data: {
    groupId: string,
    groupName: string,
    description?: string,
    invitedBy: string,
    invitedByName: string,
    inviteId: string,
    goalAmount: number,
    currentAmount: number,
    memberCount: number,
    maxMembers: number,
    minMembers: number,
    deadline?: string,
    autoSave: boolean,
    autoSaveAmount?: number,
    autoSaveFrequency?: string,
    policy: {
      allowEarlyWithdrawal: boolean,
      earlyWithdrawalPenalty: number,
      minimumContributionPeriod: number,
      maximumContributionPeriod: number,
      contributionAmount: string,
      fixedAmount?: number,
      minimumContribution: number,
      maximumContribution: number,
      deadlineExtensionAllowed: boolean,
      maxDeadlineExtensions: number,
      deadlineExtensionDays: number,
      allowMemberRemoval: boolean,
      allowMemberAddition: boolean,
      distributionMethod: string,
      lateContributionPenalty: number,
      earlyCompletionBonus: number,
      inactivityPenalty: number,
      autoSaveEnabled: boolean,
      autoSaveFrequency: string,
    },
    goalProgress: number, // Calculated percentage
    daysRemaining?: number, // Calculated days until deadline
    expiresAt?: string,
  },
  actionUrl: `/groups/invite/${groupId}/${inviteId}`,
}
```

**Note**: This is for direct invitations via phone number. For public invite codes, users manually enter the code and no notification is sent.

**Comprehensive Group Details Included**:
- **Basic Info**: Name, description, goal amount, current progress
- **Member Limits**: Current, minimum, and maximum members
- **Timeline**: Deadline and days remaining
- **Auto-save Settings**: Whether enabled, amount, and frequency
- **Complete Policy**: All group rules, penalties, and settings
- **Calculated Values**: Goal progress percentage and days remaining

#### `group_joined`
**Trigger**: User successfully joins group
**Priority**: Normal
**Category**: Group

```ts
{
  type: 'group_joined',
  title: 'Welcome to the Group!',
  message: `You've successfully joined ${groupName}`,
  category: 'group',
  priority: 'normal',
  data: {
    groupId: string,
    groupName: string,
    memberCount: number,
    goalAmount: number,
  },
  actionUrl: `/groups/${groupId}`,
}
```

#### `member_joined`
**Trigger**: New member joins existing group
**Priority**: Normal
**Category**: Group

```ts
{
  type: 'member_joined',
  title: 'New Member Joined',
  message: `${userName} joined ${groupName}`,
  category: 'group',
  priority: 'normal',
  data: {
    groupId: string,
    groupName: string,
    userId: string,
    userName: string,
    memberCount: number,
  },
  actionUrl: `/groups/${groupId}`,
}
```

#### `member_left`
**Trigger**: Member leaves group
**Priority**: Normal
**Category**: Group

```ts
{
  type: 'member_left',
  title: 'Member Left Group',
  message: `${userName} left ${groupName}`,
  category: 'group',
  priority: 'normal',
  data: {
    groupId: string,
    groupName: string,
    userId: string,
    userName: string,
    memberCount: number,
    reason?: string,
  },
  actionUrl: `/groups/${groupId}`,
}
```

#### `contribution_made`
**Trigger**: Member contributes to group
**Priority**: Normal
**Category**: Group

```ts
{
  type: 'contribution_made',
  title: 'New Contribution',
  message: `${userName} contributed ₦${amount} to ${groupName}`,
  category: 'group',
  priority: 'normal',
  data: {
    groupId: string,
    groupName: string,
    userId: string,
    userName: string,
    amount: number,
    totalContributed: number,
    goalProgress: number,
  },
  actionUrl: `/groups/${groupId}`,
}
```

#### `group_goal_reached`
**Trigger**: Group reaches its goal amount
**Priority**: High
**Category**: Group

```ts
{
  type: 'group_goal_reached',
  title: 'Goal Reached!',
  message: `Congratulations! ${groupName} has reached its goal of ₦${goalAmount}`,
  category: 'group',
  priority: 'high',
  data: {
    groupId: string,
    groupName: string,
    goalAmount: number,
    currentAmount: number,
    memberCount: number,
  },
  actionUrl: `/groups/${groupId}`,
}
```

#### `group_disbanded`
**Trigger**: Group is disbanded by owner
**Priority**: High
**Category**: Group

```ts
{
  type: 'group_disbanded',
  title: 'Group Disbanded',
  message: `${groupName} has been disbanded. Funds distributed to members.`,
  category: 'group',
  priority: 'high',
  data: {
    groupId: string,
    groupName: string,
    totalDistributed: number,
    memberCount: number,
    disbursementFee: number,
  },
  actionUrl: `/groups/${groupId}`,
}
```

#### `auto_save_failed`
**Trigger**: Auto-save payment fails
**Priority**: High
**Category**: Group

```ts
{
  type: 'auto_save_failed',
  title: 'Auto-Save Failed',
  message: `Auto-save of ₦${amount} failed for ${groupName}. Please check your card.`,
  category: 'group',
  priority: 'high',
  data: {
    groupId: string,
    groupName: string,
    amount: number,
    errorCode: string,
    errorMessage: string,
    penaltyApplied?: number,
  },
  actionUrl: `/groups/${groupId}`,
}
```

#### `penalty_applied`
**Trigger**: Penalty applied to member
**Priority**: High
**Category**: Group

```ts
{
  type: 'penalty_applied',
  title: 'Penalty Applied',
  message: `Penalty of ₦${amount} applied for ${reason}`,
  category: 'group',
  priority: 'high',
  data: {
    groupId: string,
    groupName: string,
    amount: number,
    reason: string,
    penaltyType: 'early_leave' | 'missed_payment' | 'rule_violation',
    newBalance: number,
  },
  actionUrl: `/groups/${groupId}`,
}
```

### 3. Security Notifications
Notifications related to account security, login alerts, and suspicious activities.

#### `login_alert`
**Trigger**: New login detected
**Priority**: High
**Category**: Security

```ts
{
  type: 'login_alert',
  title: 'New Login Detected',
  message: `New login from ${location} on ${deviceType}`,
  category: 'security',
  priority: 'high',
  data: {
    location: string,
    deviceType: string,
    ipAddress: string,
    timestamp: string,
    isSuspicious: boolean,
  },
  actionUrl: '/settings/security',
}
```

#### `password_changed`
**Trigger**: Password successfully changed
**Priority**: Normal
**Category**: Security

```ts
{
  type: 'password_changed',
  title: 'Password Changed',
  message: 'Your password has been changed successfully',
  category: 'security',
  priority: 'normal',
  data: {
    timestamp: string,
    deviceType: string,
    location: string,
  },
  actionUrl: '/settings/security',
}
```

#### `account_locked`
**Trigger**: Account temporarily locked
**Priority**: Urgent
**Category**: Security

```ts
{
  type: 'account_locked',
  title: 'Account Temporarily Locked',
  message: 'Your account has been locked due to suspicious activity',
  category: 'security',
  priority: 'urgent',
  data: {
    reason: string,
    lockoutDuration: number,
    unlockTime: string,
  },
  actionUrl: '/settings/security',
}
```

#### `suspicious_activity`
**Trigger**: Suspicious activity detected
**Priority**: High
**Category**: Security

```ts
{
  type: 'suspicious_activity',
  title: 'Suspicious Activity Detected',
  message: 'We detected unusual activity on your account',
  category: 'security',
  priority: 'high',
  data: {
    activityType: string,
    timestamp: string,
    location: string,
    deviceType: string,
  },
  actionUrl: '/settings/security',
}
```

#### `device_added`
**Trigger**: New device added to account
**Priority**: Normal
**Category**: Security

```ts
{
  type: 'device_added',
  title: 'New Device Added',
  message: `New device "${deviceName}" added to your account`,
  category: 'security',
  priority: 'normal',
  data: {
    deviceName: string,
    deviceType: string,
    location: string,
    timestamp: string,
  },
  actionUrl: '/settings/devices',
}
```

#### `device_removed`
**Trigger**: Device removed from account
**Priority**: Normal
**Category**: Security

```ts
{
  type: 'device_removed',
  title: 'Device Removed',
  message: `Device "${deviceName}" removed from your account`,
  category: 'security',
  priority: 'normal',
  data: {
    deviceName: string,
    deviceType: string,
    removedBy: string,
    timestamp: string,
  },
  actionUrl: '/settings/devices',
}
```

### 4. System Notifications
Notifications related to app updates, maintenance, and system announcements.

#### `app_update`
**Trigger**: New app version available
**Priority**: Normal
**Category**: System

```ts
{
  type: 'app_update',
  title: 'App Update Available',
  message: 'A new version of CoinClique is available with new features',
  category: 'system',
  priority: 'normal',
  data: {
    version: string,
    features: string[],
    isRequired: boolean,
  },
  actionUrl: '/settings/app-update',
}
```

#### `maintenance`
**Trigger**: Scheduled maintenance
**Priority**: High
**Category**: System

```ts
{
  type: 'maintenance',
  title: 'Scheduled Maintenance',
  message: 'CoinClique will be unavailable for maintenance',
  category: 'system',
  priority: 'high',
  data: {
    startTime: string,
    endTime: string,
    duration: number,
    reason: string,
  },
  actionUrl: '/maintenance',
}
```

#### `feature_announcement`
**Trigger**: New feature announcement
**Priority**: Normal
**Category**: System

```ts
{
  type: 'feature_announcement',
  title: 'New Feature Available',
  message: 'Check out our new feature: ${featureName}',
  category: 'system',
  priority: 'normal',
  data: {
    featureName: string,
    featureDescription: string,
    featureUrl: string,
  },
  actionUrl: featureUrl,
}
```

#### `policy_update`
**Trigger**: Terms of service or privacy policy update
**Priority**: Normal
**Category**: System

```ts
{
  type: 'policy_update',
  title: 'Policy Update',
  message: 'Our terms of service have been updated',
  category: 'system',
  priority: 'normal',
  data: {
    policyType: 'terms' | 'privacy',
    version: string,
    changes: string[],
  },
  actionUrl: '/legal/terms',
}
```

#### `account_verification`
**Trigger**: Account verification required
**Priority**: High
**Category**: System

```ts
{
  type: 'account_verification',
  title: 'Account Verification Required',
  message: 'Please verify your account to continue using CoinClique',
  category: 'system',
  priority: 'high',
  data: {
    verificationType: 'email' | 'phone' | 'identity',
    deadline: string,
  },
  actionUrl: '/verification',
}
```

## Notification Priority Levels

### Low Priority
- General announcements
- Non-critical updates
- Informational messages

### Normal Priority
- Most user activities
- Group interactions
- Payment confirmations
- Security confirmations

### High Priority
- Failed payments
- Security alerts
- Group goal reached
- Auto-save failures
- Penalties applied

### Urgent Priority
- Account locked
- Critical security issues
- System-wide issues
- Emergency maintenance

## Notification Categories

### Payment
- Financial transactions
- Card management
- Wallet operations
- Withdrawals

### Group
- Group activities
- Member management
- Contributions
- Group events

### Security
- Account security
- Login alerts
- Device management
- Suspicious activities

### System
- App updates
- Maintenance
- Feature announcements
- Policy updates

## Implementation Guidelines

### 1. Data Structure
All notifications should follow the standard structure:
```ts
interface NotificationData {
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  category?: string;
  actionUrl?: string;
  actionData?: Record<string, any>;
  expiresAt?: Date;
}
```

### 2. Localization
- Use template variables for dynamic content
- Support multiple languages
- Format currency amounts properly
- Use appropriate date/time formats

### 3. Action URLs
- Use deep links for in-app navigation
- Include relevant data in actionData
- Handle both success and error states

### 4. Expiration
- Set appropriate expiration times
- Critical notifications: 7 days
- Normal notifications: 30 days
- System notifications: 90 days

### 5. Batch Notifications
- Use batch operations for group notifications
- Respect user preferences
- Implement rate limiting
- Handle failures gracefully

This reference ensures consistent notification implementation across all CoinClique features and provides a comprehensive guide for developers implementing the notification system.

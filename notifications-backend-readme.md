# Notifications Backend API (Firebase + Expo Push Notifications)

Audience: Another AI/dev building a comprehensive notification system for CoinClique. Implement either Next.js (App Router or Pages) or NestJS. The mobile app will receive real-time notifications for all user activities and system events.

## Goals

- **Real-time notifications** for all user activities
- **Push notifications** for critical events (payments, group activities, security) via Expo Push Notifications
- **In-app notifications** with rich content and actions
- **Notification preferences** per user
- **Notification history** with pagination and filtering
- **Cross-platform support** (iOS, Android, Web)

## Domain Model (Firestore)

### Core Collections

- `users/{uid}`
  - `notifications`: { `enabled`, `pushEnabled`, `emailEnabled`, `preferences: { groups, payments, security, system }` }
  - `notificationSettings`: { `quietHours`, `quietHoursStart`, `quietHoursEnd`, `timezone` }
  - `expoPushToken`: string (Expo push token)

- `notifications/{notificationId}`
  - { `uid`, `type`, `title`, `message`, `data`, `status: 'unread'|'read'|'archived'`, `priority: 'low'|'normal'|'high'|'urgent'`, `category`, `actionUrl?`, `actionData?`, `createdAt`, `readAt?`, `expiresAt?` }

- `notification_templates/{templateId}`
  - { `type`, `title`, `message`, `variables: string[]`, `category`, `priority`, `actionUrl?`, `actionData?`, `isActive` }

- `notification_batches/{batchId}`
  - { `type`, `recipients: string[]`, `templateId`, `data`, `status: 'pending'|'sent'|'failed'`, `createdAt`, `sentAt?`, `failedCount`, `successCount` }

## Environment Variables

- `FIREBASE_SERVICE_ACCOUNT` (JSON or use Admin default creds)
- `FIREBASE_PROJECT_ID`
- `EXPO_ACCESS_TOKEN` (Expo push notification access token)
- `SENDGRID_API_KEY` (for email notifications)
- `NOTIFICATION_WEBHOOK_SECRET` (for external integrations)

---

## Option A: Next.js (App Router)

Install:

```bash
npm i firebase-admin @sendgrid/mail expo-server-sdk
```

Initialize Firebase Admin (e.g., `lib/firebase-admin.ts`):

```ts
// lib/firebase-admin.ts
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Expo } from 'expo-server-sdk';

if (!getApps().length) {
  initializeApp({
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : undefined,
  });
}

export const db = getFirestore();
export const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
```

Notification service:

```ts
// lib/notifications.ts
import { db, expo } from './firebase-admin';
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export interface NotificationData {
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

export interface NotificationTemplate {
  type: string;
  title: string;
  message: string;
  variables: string[];
  category: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  actionUrl?: string;
  actionData?: Record<string, any>;
}

class NotificationService {
  /**
   * Send notification to single user
   */
  async sendNotification(uid: string, notification: NotificationData): Promise<string> {
    try {
      // Check user notification preferences
      const userPrefs = await this.getUserNotificationPreferences(uid);
      if (!userPrefs.enabled) {
        console.log(`Notifications disabled for user ${uid}`);
        return '';
      }

      // Create notification document
      const notificationRef = db.collection('notifications').doc();
      const notificationDoc = {
        uid,
        ...notification,
        status: 'unread',
        createdAt: new Date().toISOString(),
        expiresAt: notification.expiresAt?.toISOString(),
      };

      await notificationRef.set(notificationDoc);

      // Send push notification if enabled
      if (userPrefs.pushEnabled && notification.priority !== 'low') {
        await this.sendPushNotification(uid, notification);
      }

      // Send email notification if enabled
      if (userPrefs.emailEnabled && notification.priority === 'urgent') {
        await this.sendEmailNotification(uid, notification);
      }

      return notificationRef.id;
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to multiple users
   */
  async sendBatchNotification(uids: string[], notification: NotificationData): Promise<string[]> {
    try {
      const batch = db.batch();
      const notificationIds: string[] = [];

      for (const uid of uids) {
        const notificationRef = db.collection('notifications').doc();
        const notificationDoc = {
          uid,
          ...notification,
          status: 'unread',
          createdAt: new Date().toISOString(),
          expiresAt: notification.expiresAt?.toISOString(),
        };

        batch.set(notificationRef, notificationDoc);
        notificationIds.push(notificationRef.id);
      }

      await batch.commit();

      // Send push notifications in batches
      const userPrefs = await this.getBatchNotificationPreferences(uids);
      const pushEnabledUsers = uids.filter(uid => userPrefs[uid]?.pushEnabled);

      if (pushEnabledUsers.length > 0 && notification.priority !== 'low') {
        await this.sendBatchPushNotification(pushEnabledUsers, notification);
      }

      return notificationIds;
    } catch (error) {
      console.error('Error sending batch notification:', error);
      throw error;
    }
  }

  /**
   * Send push notification using Expo Push Notifications
   */
  private async sendPushNotification(uid: string, notification: NotificationData): Promise<void> {
    try {
      // Get user's Expo push token from Firestore
      const userDoc = await db.collection('users').doc(uid).get();
      const expoPushToken = userDoc.data()?.expoPushToken;

      if (!expoPushToken) {
        console.log(`No Expo push token for user ${uid}`);
        return;
      }

      // Validate the Expo push token
      if (!Expo.isExpoPushToken(expoPushToken)) {
        console.log(`Invalid Expo push token for user ${uid}: ${expoPushToken}`);
        return;
      }

      const message = {
        to: expoPushToken,
        sound: notification.priority === 'urgent' ? 'urgent.wav' : 'default',
        title: notification.title,
        body: notification.message,
        data: {
          type: notification.type,
          category: notification.category || '',
          priority: notification.priority || 'normal',
          actionUrl: notification.actionUrl || '',
          ...notification.data,
        },
        priority: notification.priority === 'urgent' ? 'high' : 'normal',
        channelId: this.getChannelId(notification.category),
      };

      const chunks = expo.chunkPushNotifications([message]);
      const tickets = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          console.error('Error sending chunk:', error);
        }
      }

      console.log(`Push notification sent to ${uid}:`, tickets);
    } catch (error) {
      console.error(`Error sending push notification to ${uid}:`, error);
    }
  }

  /**
   * Send batch push notifications using Expo
   */
  private async sendBatchPushNotification(uids: string[], notification: NotificationData): Promise<void> {
    try {
      // Get Expo push tokens for all users
      const userDocs = await Promise.all(
        uids.map(uid => db.collection('users').doc(uid).get())
      );

      const messages = userDocs
        .map(doc => {
          const expoPushToken = doc.data()?.expoPushToken;
          if (!expoPushToken || !Expo.isExpoPushToken(expoPushToken)) {
            return null;
          }
          return {
            to: expoPushToken,
            sound: notification.priority === 'urgent' ? 'urgent.wav' : 'default',
            title: notification.title,
            body: notification.message,
            data: {
              type: notification.type,
              category: notification.category || '',
              priority: notification.priority || 'normal',
              actionUrl: notification.actionUrl || '',
              ...notification.data,
            },
            priority: notification.priority === 'urgent' ? 'high' : 'normal',
            channelId: this.getChannelId(notification.category),
          };
        })
        .filter(Boolean);

      if (messages.length === 0) {
        console.log('No valid Expo push tokens found for batch notification');
        return;
      }

      const chunks = expo.chunkPushNotifications(messages);
      const tickets = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          console.error('Error sending chunk:', error);
        }
      }

      console.log(`Batch push notification sent:`, {
        successCount: tickets.filter(ticket => ticket.status === 'ok').length,
        failureCount: tickets.filter(ticket => ticket.status === 'error').length,
      });
    } catch (error) {
      console.error('Error sending batch push notification:', error);
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(uid: string, notification: NotificationData): Promise<void> {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      const userEmail = userDoc.data()?.email;

      if (!userEmail) {
        console.log(`No email for user ${uid}`);
        return;
      }

      const emailContent = this.generateEmailContent(notification);

      const msg = {
        to: userEmail,
        from: 'notifications@coinclique.app',
        subject: notification.title,
        html: emailContent,
      };

      await sgMail.send(msg);
      console.log(`Email notification sent to ${uid}`);
    } catch (error) {
      console.error(`Error sending email notification to ${uid}:`, error);
    }
  }

  /**
   * Get notification channel ID for Android
   */
  private getChannelId(category?: string): string {
    switch (category) {
      case 'payment':
        return 'payments';
      case 'security':
        return 'security';
      case 'group':
        return 'groups';
      case 'system':
        return 'system';
      default:
        return 'general';
    }
  }

  /**
   * Generate email content
   */
  private generateEmailContent(notification: NotificationData): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${notification.title}</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">${notification.title}</h2>
            <p>${notification.message}</p>
            ${notification.actionUrl ? `
              <a href="${notification.actionUrl}" 
                 style="display: inline-block; background: #2563eb; color: white; 
                        padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                View Details
              </a>
            ` : ''}
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="font-size: 12px; color: #6b7280;">
              This is an automated notification from CoinClique.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Get user notification preferences
   */
  private async getUserNotificationPreferences(uid: string): Promise<{
    enabled: boolean;
    pushEnabled: boolean;
    emailEnabled: boolean;
    preferences: Record<string, boolean>;
  }> {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      const userData = userDoc.data();

      return {
        enabled: userData?.notifications?.enabled ?? true,
        pushEnabled: userData?.notifications?.pushEnabled ?? true,
        emailEnabled: userData?.notifications?.emailEnabled ?? false,
        preferences: userData?.notifications?.preferences ?? {
          groups: true,
          payments: true,
          security: true,
          system: true,
        },
      };
    } catch (error) {
      console.error('Error getting user notification preferences:', error);
      return {
        enabled: true,
        pushEnabled: true,
        emailEnabled: false,
        preferences: {
          groups: true,
          payments: true,
          security: true,
          system: true,
        },
      };
    }
  }

  /**
   * Get batch notification preferences
   */
  private async getBatchNotificationPreferences(uids: string[]): Promise<Record<string, any>> {
    try {
      const userDocs = await Promise.all(
        uids.map(uid => db.collection('users').doc(uid).get())
      );

      const preferences: Record<string, any> = {};
      userDocs.forEach((doc, index) => {
        const userData = doc.data();
        preferences[uids[index]] = {
          enabled: userData?.notifications?.enabled ?? true,
          pushEnabled: userData?.notifications?.pushEnabled ?? true,
          emailEnabled: userData?.notifications?.emailEnabled ?? false,
        };
      });

      return preferences;
    } catch (error) {
      console.error('Error getting batch notification preferences:', error);
      return {};
    }
  }
}

export const notificationService = new NotificationService();
```

## API Endpoints

### GET /api/notifications
Query: `?limit=20&offset=0&status=unread&category=payment`

Returns user's notifications with pagination and filtering.

```ts
// app/api/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { verifyAuthToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const priority = searchParams.get('priority');

    let query = db.collection('notifications').where('uid', '==', uid);

    if (status) {
      query = query.where('status', '==', status);
    }
    if (category) {
      query = query.where('category', '==', category);
    }
    if (priority) {
      query = query.where('priority', '==', priority);
    }

    query = query.orderBy('createdAt', 'desc').limit(limit).offset(offset);

    const snapshot = await query.get();
    const notifications = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({
      success: true,
      notifications,
      hasMore: notifications.length === limit,
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### POST /api/notifications/read
Body: { notificationIds: string[] }

Mark notifications as read.

```ts
// app/api/notifications/read/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { verifyAuthToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { notificationIds } = await req.json();

    if (!Array.isArray(notificationIds)) {
      return NextResponse.json({ error: 'Invalid notification IDs' }, { status: 400 });
    }

    const batch = db.batch();
    const now = new Date().toISOString();

    for (const notificationId of notificationIds) {
      const notificationRef = db.collection('notifications').doc(notificationId);
      batch.update(notificationRef, {
        status: 'read',
        readAt: now,
      });
    }

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### DELETE /api/notifications
Body: { notificationIds: string[] }

Archive/delete notifications.

```ts
// app/api/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { verifyAuthToken } from '@/lib/auth';

export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { notificationIds } = await req.json();

    if (!Array.isArray(notificationIds)) {
      return NextResponse.json({ error: 'Invalid notification IDs' }, { status: 400 });
    }

    const batch = db.batch();

    for (const notificationId of notificationIds) {
      const notificationRef = db.collection('notifications').doc(notificationId);
      batch.update(notificationRef, {
        status: 'archived',
      });
    }

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error archiving notifications:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### GET /api/notifications/unread-count
Returns count of unread notifications.

```ts
// app/api/notifications/unread-count/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { verifyAuthToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const snapshot = await db.collection('notifications')
      .where('uid', '==', uid)
      .where('status', '==', 'unread')
      .count()
      .get();

    return NextResponse.json({
      success: true,
      count: snapshot.data().count,
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### PUT /api/notifications/settings
Body: { enabled, pushEnabled, emailEnabled, preferences, quietHours }

Update user notification settings.

```ts
// app/api/notifications/settings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { verifyAuthToken } from '@/lib/auth';

export async function PUT(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await req.json();

    await db.collection('users').doc(uid).update({
      notifications: {
        enabled: settings.enabled ?? true,
        pushEnabled: settings.pushEnabled ?? true,
        emailEnabled: settings.emailEnabled ?? false,
        preferences: settings.preferences ?? {
          groups: true,
          payments: true,
          security: true,
          system: true,
        },
      },
      notificationSettings: {
        quietHours: settings.quietHours ?? false,
        quietHoursStart: settings.quietHoursStart ?? '22:00',
        quietHoursEnd: settings.quietHoursEnd ?? '08:00',
        timezone: settings.timezone ?? 'UTC',
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating notification settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### POST /api/notifications/expo-token
Body: { expoPushToken }

Register/update user's Expo push token for push notifications.

```ts
// app/api/notifications/expo-token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { verifyAuthToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { expoPushToken } = await req.json();

    if (!expoPushToken) {
      return NextResponse.json({ error: 'Expo push token required' }, { status: 400 });
    }

    await db.collection('users').doc(uid).update({
      expoPushToken,
      expoPushTokenUpdatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating Expo push token:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

## Notification Types & Templates

### Payment Notifications
- **Payment Success**: "Payment of ₦X successful"
- **Payment Failed**: "Payment failed - please retry"
- **Card Linked**: "Card successfully linked"
- **Card Expired**: "Your card has expired"
- **Low Balance**: "Wallet balance is low"
- **Withdrawal Success**: "Withdrawal of ₦X successful"
- **Withdrawal Failed**: "Withdrawal failed - funds returned"

### Group Notifications
- **Group Invite**: "You're invited to join [Group Name]"
- **Group Joined**: "Welcome to [Group Name]"
- **Member Joined**: "[User] joined [Group Name]"
- **Member Left**: "[User] left [Group Name]"
- **Contribution Made**: "[User] contributed ₦X to [Group Name]"
- **Group Goal Reached**: "Congratulations! [Group Name] reached its goal"
- **Group Disbanded**: "[Group Name] has been disbanded"
- **Auto-save Failed**: "Auto-save failed for [Group Name]"

### Security Notifications
- **Login Alert**: "New login detected"
- **Password Changed**: "Password changed successfully"
- **Account Locked**: "Account temporarily locked"
- **Suspicious Activity**: "Suspicious activity detected"
- **Device Added**: "New device added to account"
- **Device Removed**: "Device removed from account"

### System Notifications
- **App Update**: "New version available"
- **Maintenance**: "Scheduled maintenance"
- **Feature Announcement**: "New feature available"
- **Policy Update**: "Terms of service updated"
- **Account Verification**: "Please verify your account"

## Integration Points

### Payment System Integration
```ts
// In payment webhook handler
if (evt.event === 'charge.success') {
  await notificationService.sendNotification(uid, {
    type: 'payment_success',
    title: 'Payment Successful',
    message: `Payment of ₦${amount} was successful`,
    category: 'payment',
    priority: 'normal',
    data: { amount, reference, paymentMethod },
  });
}
```

### Group System Integration
```ts
// In group join handler
await notificationService.sendNotification(uid, {
  type: 'group_joined',
  title: 'Welcome to the Group!',
  message: `You've successfully joined ${groupName}`,
  category: 'group',
  priority: 'normal',
  actionUrl: `/groups/${groupId}`,
  data: { groupId, groupName },
});
```

### Security System Integration
```ts
// In login handler
await notificationService.sendNotification(uid, {
  type: 'login_alert',
  title: 'New Login Detected',
  message: `New login from ${deviceInfo.location}`,
  category: 'security',
  priority: 'high',
  data: { deviceInfo, location, timestamp },
});
```

## Mobile App Integration

### Expo Push Token Registration
```ts
// In mobile app
import * as Notifications from 'expo-notifications';

const registerExpoPushToken = async () => {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return;
  }
  
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: 'your-expo-project-id', // Get this from your Expo project settings
  });
  
  await apiClient.post('/notifications/expo-token', { expoPushToken: token.data });
};

// Call this when user logs in
useEffect(() => {
  registerExpoPushToken();
}, []);
```

### Notification Handling
```ts
// Handle background notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Handle notification received when app is in foreground
const notificationListener = Notifications.addNotificationReceivedListener(notification => {
  // Update local notification count
  // Navigate to relevant screen if needed
});

// Handle notification response (when user taps notification)
const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
  const data = response.notification.request.content.data;
  
  // Navigate based on notification data
  if (data.actionUrl) {
    // Navigate to the specified URL
    router.push(data.actionUrl);
  }
});

// Clean up listeners
useEffect(() => {
  return () => {
    Notifications.removeNotificationSubscription(notificationListener);
    Notifications.removeNotificationSubscription(responseListener);
  };
}, []);
```

## Performance & Scalability

### Batch Processing
- Use Firestore batch operations for multiple notifications
- Implement notification queues for high-volume scenarios
- Use Firebase Functions for background processing

### Caching Strategy
- Cache notification templates
- Cache user preferences
- Implement notification count caching

### Rate Limiting
- Limit notification frequency per user
- Implement quiet hours
- Prevent notification spam
- Respect Expo Push Notifications rate limits (100 requests per second per project)

## Testing

### Test Cases
1. **Single User Notification**: Test notification delivery to one user
2. **Batch Notifications**: Test sending to multiple users
3. **Push Notifications**: Test Expo Push Notifications delivery
4. **Email Notifications**: Test email delivery
5. **Notification Preferences**: Test user preference filtering
6. **Quiet Hours**: Test quiet hours functionality

### Load Testing
1. **High Volume**: Test with thousands of notifications
2. **Concurrent Users**: Test with multiple simultaneous users
3. **Expo Limits**: Test Expo Push Notifications rate limits and quotas

## Security Considerations

1. **Token Validation**: Always verify Firebase tokens
2. **Data Sanitization**: Sanitize all notification content
3. **Rate Limiting**: Prevent notification abuse
4. **Privacy**: Don't expose sensitive data in notifications
5. **Audit Logging**: Log all notification activities

## Monitoring & Analytics

### Key Metrics
- Notification delivery rates
- Push notification open rates
- Email notification click rates
- User engagement with notifications
- Notification preference changes

### Error Tracking
- Failed Expo Push Notifications deliveries
- Email delivery failures
- Template rendering errors
- User preference errors
- Invalid Expo push tokens

This notification system provides a comprehensive solution for all CoinClique notification needs, from simple in-app notifications to critical security alerts.

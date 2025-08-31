import { db, expo } from './firebase-admin';
import { Expo } from 'expo-server-sdk';
import sgMail from '@sendgrid/mail';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export interface NotificationData {
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  category?: string;
  actionUrl?: string;
  actionData?: Record<string, unknown>;
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
  actionData?: Record<string, unknown>;
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
        priority: (notification.priority === 'urgent' ? 'high' : 'default') as 'high' | 'default',
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
            priority: (notification.priority === 'urgent' ? 'high' : 'default') as 'high' | 'default',
            channelId: this.getChannelId(notification.category),
          };
        })
        .filter((msg): msg is NonNullable<typeof msg> => msg !== null);

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
  private async getBatchNotificationPreferences(uids: string[]): Promise<Record<string, {
    enabled: boolean;
    pushEnabled: boolean;
    emailEnabled: boolean;
  }>> {
    try {
      const userDocs = await Promise.all(
        uids.map(uid => db.collection('users').doc(uid).get())
      );

      const preferences: Record<string, {
        enabled: boolean;
        pushEnabled: boolean;
        emailEnabled: boolean;
      }> = {};
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

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

// Helper function to verify Firebase token
async function verifyAuthToken(req: NextRequest): Promise<string | null> {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await getAuth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

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

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



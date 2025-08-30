import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export async function GET(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
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
    const { searchParams } = new URL(req.url);
    
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Validate limit
    if (limit > 100) {
      return NextResponse.json(
        { success: false, error: 'Limit cannot exceed 100', code: 'INVALID_LIMIT' },
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
    
    // Check if user is a member
    if (!groupData?.members?.includes(uid)) {
      return NextResponse.json(
        { success: false, error: 'Access denied', code: 'INSUFFICIENT_PERMISSIONS' },
        { status: 403 }
      );
    }

    // Get messages with pagination
    const messagesRef = db.collection('group_messages');
    let query = messagesRef
      .where('groupId', '==', groupId)
      .orderBy('timestamp', 'desc')
      .limit(limit);

    // Apply offset by skipping documents
    if (offset > 0) {
      const offsetQuery = messagesRef
        .where('groupId', '==', groupId)
        .orderBy('timestamp', 'desc')
        .limit(offset);
      
      const offsetSnapshot = await offsetQuery.get();
      const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
      
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
    }

    const messagesSnapshot = await query.get();
    
    // Check if there are more messages
    const hasMore = messagesSnapshot.docs.length === limit;
    
    // Format messages
    const messages = messagesSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        messageId: doc.id,
        groupId: data.groupId,
        userId: data.userId,
        text: data.text,
        timestamp: data.timestamp,
        userName: data.userName,
        userAvatar: data.userAvatar,
        messageType: data.messageType,
        metadata: data.metadata
      };
    });

    return NextResponse.json({
      success: true,
      messages,
      hasMore
    });

  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

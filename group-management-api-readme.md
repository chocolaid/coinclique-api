# Group Management API Specification

## Overview
This API handles all group-related operations including creation, management, invites, policies, and member operations. It's designed to work with the CoinClique mobile app and handles Firebase authentication and Firestore operations server-side.

## Base URL
```
https://coinclique-api.vercel.app/api/groups
```

## Authentication
All endpoints require a valid Firebase ID token in the Authorization header:
```
Authorization: Bearer {firebase_id_token}
```

## Endpoints

### 1. Create Group
**POST** `/create`

**Request Body:**
```json
{
  "name": "Family Savings",
  "description": "Monthly family savings group",
  "goalAmount": 500000,
  "autoSave": true,
  "frequency": "monthly",
  "autoSaveAmount": 50000,
  "autoSaveDay": 1,
  "policy": {
    "allowEarlyWithdrawal": false,
    "earlyWithdrawalPenalty": 10,
    "minimumContributionPeriod": 30,
    "maximumContributionPeriod": 365,
    "contributionAmount": "fixed",
    "fixedAmount": 50000,
    "minimumContribution": 10000,
    "maximumContribution": 100000,
    "deadlineExtensionAllowed": true,
    "maxDeadlineExtensions": 3,
    "deadlineExtensionDays": 30,
    "allowMemberRemoval": false,
    "allowMemberAddition": true,
    "maxMembers": 10,
    "minMembers": 2,
    "distributionMethod": "equal",
    "lateContributionPenalty": 5,
    "earlyCompletionBonus": 2,
    "inactivityPenalty": 7,
    "autoSaveEnabled": true,
    "autoSaveFrequency": "monthly"
  }
}
```

**Response:**
```json
{
  "success": true,
  "groupId": "group_123",
  "chatId": "chat_456",
  "inviteCode": "ABC123",
  "message": "Group created successfully"
}
```

### 2. Get Group Details
**GET** `/details/{groupId}`

**Response:**
```json
{
  "success": true,
  "group": {
    "groupId": "group_123",
    "name": "Family Savings",
    "description": "Monthly family savings group",
    "goalAmount": 500000,
    "currentAmount": 150000,
    "members": ["user1", "user2", "user3"],
    "status": "active",
    "autoSave": true,
    "frequency": "monthly",
    "autoSaveAmount": 50000,
    "autoSaveDay": 1,
    "deadline": "2024-12-31T23:59:59Z",
    "chatId": "chat_456",
    "inviteCode": "ABC123",
    "policy": { /* policy object */ },
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### 3. Update Group
**PUT** `/update/{groupId}`

**Request Body:**
```json
{
  "name": "Updated Group Name",
  "description": "Updated description",
  "goalAmount": 600000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Group updated successfully"
}
```

### 4. Update Group Policy
**PUT** `/policy/{groupId}`

**Request Body:**
```json
{
  "policy": {
    "allowEarlyWithdrawal": true,
    "earlyWithdrawalPenalty": 15,
    "autoSaveEnabled": false,
    "maxMembers": 15,
    "minMembers": 3
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Policy updated successfully"
}
```

### 5. Generate Invite Code
**POST** `/invite-code/{groupId}`

**Response:**
```json
{
  "success": true,
  "inviteCode": "XYZ789",
  "message": "Invite code generated successfully"
}
```

### 6. Invite User to Group
**POST** `/invite/{groupId}`

**Request Body:**
```json
{
  "phoneNumber": "+2348012345678"
}
```

**Response:**
```json
{
  "success": true,
  "inviteId": "invite_123",
  "message": "Invitation sent successfully"
}
```

### 7. Get Group Invites
**GET** `/invites/{groupId}`

**Response:**
```json
{
  "success": true,
  "invites": [
    {
      "inviteId": "invite_123",
      "groupId": "group_123",
      "userId": "user_456",
      "invitedBy": "user1",
      "status": "pending",
      "invitedAt": "2024-01-01T00:00:00Z",
      "user": {
        "uid": "user_456",
        "name": "John Doe",
        "phone": "+2348012345678",
        "avatar": "https://..."
      }
    }
  ]
}
```

### 8. Join Group with Invite Code
**POST** `/join/{groupId}`

**Request Body:**
```json
{
  "inviteCode": "ABC123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully joined group"
}
```

### 9. Leave Group
**POST** `/leave/{groupId}`

**Response:**
```json
{
  "success": true,
  "message": "Successfully left group"
}
```

### 10. Delete Group
**DELETE** `/delete/{groupId}`

**Response:**
```json
{
  "success": true,
  "message": "Group deleted successfully"
}
```

### 11. Get Group Members
**GET** `/members/{groupId}`

**Response:**
```json
{
  "success": true,
  "members": [
    {
      "uid": "user1",
      "name": "John Doe",
      "phone": "+2348012345678",
      "avatar": "https://...",
      "joinedAt": "2024-01-01T00:00:00Z",
      "totalContributed": 150000,
      "lastContributionDate": "2024-01-01T00:00:00Z",
      "contributionCount": 3,
      "status": "active"
    }
  ]
}
```

### 12. Get User's Groups
**GET** `/user-groups`

**Response:**
```json
{
  "success": true,
  "groups": [
    {
      "groupId": "group_123",
      "name": "Family Savings",
      "goalAmount": 500000,
      "currentAmount": 150000,
      "status": "active",
      "members": ["user1", "user2", "user3"],
      "isCreator": true,
      "lastActivity": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 13. Pause/Resume Group
**POST** `/status/{groupId}`

**Request Body:**
```json
{
  "action": "pause" // or "resume"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Group paused successfully",
  "newStatus": "paused"
}
```

### 14. Get Group Statistics
**GET** `/stats/{groupId}`

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalMembers": 3,
    "activeMembers": 3,
    "totalContributed": 150000,
    "goalProgress": 30,
    "daysRemaining": 180,
    "averageContribution": 50000,
    "lastContributionDate": "2024-01-01T00:00:00Z"
  }
}
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**Common Error Codes:**
- `INVALID_TOKEN`: Invalid or expired Firebase token
- `GROUP_NOT_FOUND`: Group doesn't exist
- `INSUFFICIENT_PERMISSIONS`: User doesn't have permission for this action
- `INVALID_INVITE_CODE`: Invalid or expired invite code
- `GROUP_FULL`: Group has reached maximum member limit
- `ALREADY_MEMBER`: User is already a member of the group
- `INVALID_POLICY`: Invalid policy configuration
- `GROUP_ACTIVE`: Cannot perform action on active group

## Implementation Notes

### Firebase Integration
1. **Authentication**: Verify Firebase ID tokens using Firebase Admin SDK
2. **Firestore**: Use Firebase Admin SDK for all database operations
3. **Security**: Implement proper validation and sanitization

### Data Validation
1. **Group Names**: 3-50 characters, alphanumeric + spaces
2. **Goal Amounts**: 1000-10,000,000 NGN
3. **Member Limits**: 2-20 members
4. **Phone Numbers**: Nigerian format validation

### Business Logic
1. **Group Status Management**: Automatic status updates based on member count and activity
2. **Policy Enforcement**: Apply penalties and bonuses according to group policies
3. **Auto-save**: Handle automatic contributions based on frequency settings
4. **Member Management**: Handle join/leave with proper fund distribution logic

### Security Considerations
1. **Rate Limiting**: Prevent abuse of invite generation and joining
2. **Input Sanitization**: Sanitize all user inputs
3. **Permission Checks**: Verify user permissions for each operation
4. **Audit Logging**: Log all group operations for security

### Performance Optimization
1. **Caching**: Cache frequently accessed group data
2. **Indexing**: Proper Firestore indexes for queries
3. **Pagination**: Implement pagination for member lists and invites
4. **Real-time Updates**: Use Firebase real-time listeners where appropriate

## Testing

### Test Cases
1. **Group Creation**: Test with valid and invalid data
2. **Policy Updates**: Test policy validation and enforcement
3. **Member Management**: Test join/leave scenarios
4. **Invite System**: Test invite code generation and usage
5. **Permission Checks**: Test access control for different user roles
6. **Error Handling**: Test all error scenarios

### Load Testing
1. **Concurrent Users**: Test with multiple simultaneous users
2. **Large Groups**: Test with maximum member limits
3. **Frequent Operations**: Test rapid policy updates and member changes

## Deployment

### Environment Variables
```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email
```

### Dependencies
- Firebase Admin SDK
- Express.js (or your preferred framework)
- JWT validation libraries
- Input validation libraries

This API will handle all group operations server-side, eliminating client-side permission issues and providing a secure, scalable solution for group management.

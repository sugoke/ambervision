# Debug: Check Your User Role

## In Browser Console (F12)

Run this command to see your user object:

```javascript
Meteor.user()
```

Look for the `role` field in the output. It should show something like:
```javascript
{
  _id: "...",
  role: "admin",  // ← This is what we need
  email: "...",
  profile: {...}
}
```

## Possible Issues:

### 1. Role Name Different
If your role is **NOT** `"admin"`, the toggle won't show.

Current check in Dashboard.jsx (line 238):
```javascript
const isRelationshipManager = user && user.role === 'admin';
```

**Possible role values:**
- `"admin"` ✓ (shows toggle)
- `"relationship_manager"` ✗ (won't show toggle)
- `"relationshipManager"` ✗ (won't show toggle)
- `"rm"` ✗ (won't show toggle)

### 2. User Object Not Loaded
If `Meteor.user()` returns `null` or `undefined`, the page might not have your user data yet.

## Quick Fix

If your RM role is named differently, we need to update line 238 in Dashboard.jsx:

**Current:**
```javascript
const isRelationshipManager = user && user.role === 'admin';
```

**Change to** (if your role is different):
```javascript
const isRelationshipManager = user && (user.role === 'admin' || user.role === 'YOUR_ACTUAL_ROLE');
```

## After Checking

Please share:
1. What does `Meteor.user().role` show in the console?
2. Do you see any console errors?

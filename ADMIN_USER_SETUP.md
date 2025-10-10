# Admin User Setup

## ✅ Admin User Creation

I've set up automatic admin user creation for your Ambervision application.

### Default Admin Credentials

```
Email: admin@example.com
Password: admin123
Role: Superadmin (Full Access)
```

## How It Works

### Automatic Creation (Recommended)

I've added code to `server/main.js` that automatically checks for and creates the admin user on server startup.

**The admin user will be created automatically the next time you restart the Meteor server.**

To restart the server:
1. Stop the current Meteor process (Ctrl+C in the terminal where it's running)
2. Run: `meteor run` or `npm start`
3. Check the console output for the admin user creation message

### Manual Creation (Alternative Method)

If you need to create the admin user manually, you can use the Meteor shell:

1. Open a new terminal in your project directory
2. Run: `meteor shell`
3. Copy and paste the contents of `insert-admin.js`
4. Press Enter

## User Structure

The admin user is created with the following structure:

```javascript
{
  username: 'admin@example.com',
  password: 'YWRtaW4xMjNzYWx0MTIz', // Hashed version of 'admin123'
  role: 'superadmin',
  profile: {
    firstName: 'Admin',
    lastName: 'User',
    preferredLanguage: 'en',
    createdAt: Date,
    updatedAt: Date
  }
}
```

## Available Roles

The system supports four user roles:

1. **superadmin** - Full system access
2. **admin** - Administrative access
3. **rm** (Relationship Manager) - Can manage assigned clients
4. **client** - Basic client access

## Code Changes Made

### server/main.js (lines 161-195)

Added admin user creation logic in the `Meteor.startup` function:
- Checks if admin user exists
- Creates admin user if not found
- Logs success/error messages to console

## Security Notes

⚠️ **Important**: For production deployment, you should:
1. Change the default admin password immediately after first login
2. Consider using a more secure password hashing algorithm (the current implementation uses simple base64 encoding)
3. Implement proper password reset functionality
4. Add two-factor authentication for admin accounts

## Files Created

1. **insert-admin.js** - Manual admin creation script for Meteor shell
2. **create-admin-user.js** - Standalone Node.js script (requires MongoDB connection)
3. **create-admin.js** - Alternative MongoDB script
4. **ADMIN_USER_SETUP.md** - This documentation file

## Verification

After server restart, you should see one of these messages in the console:

**If admin user was created:**
```
👤 Checking for admin user...
✅ Admin user created successfully!
   Email: admin@example.com
   Password: admin123
   Role: superadmin
   User ID: [generated-id]
```

**If admin user already exists:**
```
👤 Checking for admin user...
⏭️  Admin user already exists
   User ID: [existing-id]
   Role: superadmin
```

## Login

After the admin user is created, you can login at:
- URL: http://localhost:3000
- Email: admin@example.com
- Password: admin123

The admin user will have full access to all features including:
- User Management
- Bank Management
- Issuer Management
- Market Data Management
- System Operations
- All Products and Reports

## Troubleshooting

If the admin user is not created:
1. Check the Meteor console for error messages
2. Verify the MongoDB connection is working
3. Use the manual creation method via Meteor shell
4. Check the `customUsers` collection in MongoDB directly

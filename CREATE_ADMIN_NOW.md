# Create Admin User - Quick Instructions

## Option 1: Browser Console (Easiest - Do This)

1. **Open your Meteor application in the browser:**
   - Go to: http://localhost:3000

2. **Open the browser console:**
   - Press `F12` or `Ctrl+Shift+I` (Windows/Linux)
   - Or right-click anywhere → "Inspect" → "Console" tab

3. **Copy and paste this command:**
   ```javascript
   Meteor.call('users.ensureSuperAdmin', (error, result) => {
     if (error) {
       console.error('Error:', error);
     } else {
       console.log('✅ Success! Result:', result);
       console.log('Email: admin@example.com');
       console.log('Password: admin123');
       console.log('Role: Superadmin');
     }
   });
   ```

4. **Press Enter**

5. **You should see:**
   - `✅ Success! Result: created` (if new user created)
   - OR `✅ Success! Result: exists` (if user already exists)

6. **Login at:** http://localhost:3000
   - Email: `admin@example.com`
   - Password: `admin123`

---

## Option 2: Create Both Demo Accounts

If you want to create both admin and client demo accounts:

```javascript
Meteor.call('users.ensureDemoAccounts', (error, result) => {
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('✅ Demo accounts created!');
    console.log('Admin - Email: admin@example.com, Password: admin123');
    console.log('Client - Email: client@example.com, Password: client123');
  }
});
```

---

## Option 3: Use Dedicated HTML Page

Open this URL in your browser:
http://localhost:3000/create-admin.html

Click the "Create Superadmin" button.

---

## Option 4: Restart Server (Automatic Creation)

The server startup code will automatically create the admin user:

1. Stop the Meteor server (Ctrl+C)
2. Run: `meteor run`
3. Look for the console message confirming admin creation

---

## Troubleshooting

### If you get "user already exists" error:
The user is already created! Try logging in with:
- Email: admin@example.com
- Password: admin123

### If you get "Method not found":
Make sure the Meteor server is running (`meteor run`)

### If nothing happens:
1. Check the browser console for errors
2. Make sure you're on http://localhost:3000 (not a different port)
3. Try refreshing the page and running the command again

---

## Admin User Details

Once created, the admin user will have:
- **Email:** admin@example.com
- **Password:** admin123
- **Role:** Superadmin (Full Access)
- **Permissions:**
  - User Management
  - Bank Management
  - Issuer Management
  - Market Data Management
  - System Operations
  - All Products and Reports

**⚠️ Important:** Change the password after first login for security!

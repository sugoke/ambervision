// Quick script to insert admin user
// Usage: Copy and paste into Meteor shell

const adminEmail = 'admin@example.com';

// Check if user exists
const existingUser = UsersCollection.findOne({ username: adminEmail });

if (existingUser) {
  print('Admin user already exists!');
  print('User ID: ' + existingUser._id);
  print('Role: ' + existingUser.role);
} else {
  // Hash password
  const hashedPassword = Buffer.from('admin123' + 'salt123').toString('base64');

  // Create admin user
  const userId = UsersCollection.insert({
    username: adminEmail,
    password: hashedPassword,
    role: 'superadmin',
    profile: {
      firstName: 'Admin',
      lastName: 'User',
      preferredLanguage: 'en',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });

  print('✅ Admin user created successfully!');
  print('User ID: ' + userId);
  print('Email: admin@example.com');
  print('Password: admin123');
  print('Role: superadmin');
}

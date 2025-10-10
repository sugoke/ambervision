// Run this with: meteor shell < create-admin-now.js
// Or copy-paste into meteor shell

const adminEmail = 'admin@example.com';

UsersCollection.findOneAsync({ username: adminEmail }).then(existingUser => {
  if (existingUser) {
    console.log('Admin user already exists!');
    console.log('User ID:', existingUser._id);
    console.log('Role:', existingUser.role);
  } else {
    // Create admin user
    const adminUser = {
      username: adminEmail,
      password: UserHelpers.hashPassword('admin123'),
      role: USER_ROLES.SUPERADMIN,
      profile: {
        firstName: 'Admin',
        lastName: 'User',
        preferredLanguage: 'en',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };

    UsersCollection.insertAsync(adminUser).then(userId => {
      console.log('✅ Admin user created successfully!');
      console.log('User ID:', userId);
      console.log('Email: admin@example.com');
      console.log('Password: admin123');
      console.log('Role: superadmin');
    }).catch(error => {
      console.error('Error creating admin:', error);
    });
  }
}).catch(error => {
  console.error('Error checking for admin:', error);
});

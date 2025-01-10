Template.mainLayout.onCreated(function() {
  this.userReady = new ReactiveVar(false);
});

Template.mainLayout.onRendered(function() {
  this.autorun(() => {
    const user = Meteor.user();
    
    // Wait for user subscription to be ready
    if (!Meteor.loggingIn() && user) {
      this.userReady.set(true);
      
      const userRole = user.profile?.role;
      
      console.log('Current user details:', {
        id: user._id,
        username: user.username,
        role: userRole,
        profile: {
          role: userRole
        },
        fullUser: user,
        ready: true
      });

      console.log('isSuperAdmin check:', {
        userId: user._id,
        username: user.username,
        role: userRole,
        profile: {
          role: userRole
        },
        isSuperAdmin: userRole === 'superAdmin',
        ready: true
      });
    } else {
      console.log('User data not ready:', {
        loggingIn: Meteor.loggingIn(),
        user: !!user,
        ready: false
      });
    }
  });
});

// Update your helpers
Template.mainLayout.helpers({
  isSuperAdmin() {
    const instance = Template.instance();
    const user = Meteor.user();
    return instance.userReady.get() && user?.profile?.role === 'superAdmin';
  }
}); 
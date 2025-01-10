import { Users } from '/imports/api/users/users.js';

Meteor.publish('superAdminSchedule', function() {
  const user = Users.findOne(this.userId);
  if (user?.role === 'superAdmin') {
    return Schedules.find({ userId: 'superAdmin' });
  }
  return this.ready();
}); 
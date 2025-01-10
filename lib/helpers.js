import { Template } from 'meteor/templating';
import { Meteor } from 'meteor/meteor';

Template.registerHelper('isSuperAdmin', function() {
  const user = Meteor.user();
  console.log('isSuperAdmin helper - user:', user);
  return user && user.profile?.role === 'superAdmin';
});

export function isSuperAdmin() {
  const user = Meteor.user();
  console.log('isSuperAdmin function - user:', user);
  console.log('User role:', user?.profile?.role);
  return user && user.profile?.role === 'superAdmin';
} 
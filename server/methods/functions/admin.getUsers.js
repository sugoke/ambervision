export const getUsers = () => {
  return Meteor.users.find({}).fetch();
}; 
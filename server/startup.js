import { Meteor } from 'meteor/meteor';

Meteor.startup(() => {
  if (process.env.NODE_ENV === 'production') {
    process.env.MONGO_URL = Meteor.settings.private.mongoUrl.production;
  }
}); 
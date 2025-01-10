import { Meteor } from 'meteor/meteor';
import { News } from '../news.js';

Meteor.publish('news', function() {
  return News.find({}, {
    sort: { 'items.date': -1 },
    limit: 50
  });
}); 
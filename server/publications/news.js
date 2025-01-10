import { Meteor } from 'meteor/meteor';
import { News } from '/imports/api/news/news.js';

Meteor.publish('news', function() {
  return News.find({}, {
    sort: { 'items.date': -1 },
    limit: 50
  });
}); 
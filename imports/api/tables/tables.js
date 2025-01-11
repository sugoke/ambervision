import { Meteor } from 'meteor/meteor';
import { TabularTables } from 'meteor/aldeed:tabular';
import { Products } from '../products/products.js';

if (Meteor.isClient) {
  Meteor.startup(() => {
    TabularTables.Products = new Tabular.Table({
      // Your table configuration
    });
  });
} 
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

export const Holdings = new Mongo.Collection('holdings');
export const Products = new Mongo.Collection('products');
export const Risk = new Mongo.Collection('risk');
export const Schedules = new Mongo.Collection('schedules');
export const Historical = new Mongo.Collection('historical');
export const Prices = new Mongo.Collection('prices');


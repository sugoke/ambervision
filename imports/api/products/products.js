// /imports/api/products/products.js
import { Mongo } from 'meteor/mongo';

export const Products = new Mongo.Collection('products');
export const Historical = new Mongo.Collection('historical');
export const Tickers = new Mongo.Collection('tickers');

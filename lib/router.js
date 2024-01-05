// /lib/router.js
import { Router } from 'meteor/iron:router';
//import '/imports/ui/layouts/HomeLayout.js';
//import '/imports/ui/layouts/ProductsLayout.js';

Router.configure({
  layoutTemplate: 'mainLayout'
});

Router.route('/', {
  template: 'home'
});

Router.route('/products', {
  name: 'products',
//  template: 'ProductsLayout'
});

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


Router.route('/productDetails', {
  name: 'productDetails',
  action: function() {
    const isin = this.params.query.isin;
    Session.set('currentISIN', isin); // Using Session to store the ISIN code
    this.render('productDetails');
  },
});


// /lib/routes.js
Router.route('/login', {
  name: 'login',
  template: 'Login'

});

Router.route('/register', {
  name: 'register',
  template: 'Register',


});

/*
Router.onBeforeAction(function() {
  if (!Meteor.userId() && !['login', 'register'].includes(this.route.getName())) {
    this.layout('loginLayout');
    this.render('login');
  } else {
    this.next();
  }
});
*/

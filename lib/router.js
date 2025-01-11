import { Router } from 'meteor/iron:router';
import { Products } from '/imports/api/products/products.js'; 
import { Meteor } from 'meteor/meteor';
import { SubscriptionManager } from './subscriptionManager';

Router.configure({
  layoutTemplate: function() {
    // Default to loginLayout if not logged in
    if (!Meteor.userId()) return 'loginLayout';
    
    // Use loginLayout for login page, mainLayout for others
    return this.route?.getName() === 'login' ? 'loginLayout' : 'mainLayout';
  }
});

Router.onBeforeAction(function() {
  if (!Meteor.userId() && this.route.getName() !== 'login') {
    this.redirect('login');
  } else {
    this.next();
  }
});

Router.onAfterAction(function() {
  if (Meteor.userId()) {
    SubscriptionManager.init();
  }
});

// Routes
Router.route('/', {
  name: 'home',
  template: 'home',
  waitOn: function() {
    // Only subscribe if user is logged in
    if (Meteor.userId()) {
      return [
        Meteor.subscribe('tabularProducts'),
        // Add other subscriptions here
      ];
    }
  }
});

Router.route('/login', {
  name: 'login',
  template: 'login'
});

Router.route('/register', {
  name: 'register',
  template: 'Register'
});

Router.route('/forgotPassword', {
  name: 'forgotPassword',
  template: 'ForgotPassword'
});

Router.route('/products', {
  name: 'products',
  template: 'products'
});

Router.route('/admin', {
  name: 'admin'
});

Router.route('/editProduct', {
  name: 'editProduct',
  action: function() {
    const mode = this.params.query.mode;
    const isin = this.params.query.isin;
    Session.set('mode', mode);
    Session.set('currentISIN', isin);
    this.render('editProduct');
  }
});

Router.route('/productDetails', {
  name: 'productDetails',
  template: 'productDetails',
  loadingTemplate: 'loading',
  waitOn: function() {
    console.log('Route waitOn - params:', this.params);
    const isin = this.params.query.isin;
    console.log('Route waitOn - ISIN:', isin);
    if (isin) {
      console.log('Route waitOn - Adding subscription');
      return [
        Meteor.subscribe('productDetails', isin, {
          onReady: function() {
            console.log('Route waitOn - Subscription ready');
          },
          onStop: function(error) {
            if (error) console.error('Route waitOn - Subscription error:', error);
          }
        })
      ];
    }
  },
  data: function() {
    if (!this.ready()) {
      console.log('Route data - Not ready yet');
      return false;
    }

    console.log('Route data - Ready, getting data');
    const isin = this.params.query.isin;
    console.log('Route data - ISIN:', isin);
    
    if (isin) {
      const product = Products.findOne({ 'genericData.ISINCode': isin });
      console.log('Route data - Product found:', product ? 'yes' : 'no');
      
      if (product) {
        // Process product if needed
        if (!product.observationsTable || !product.observationsTable.length) {
          console.log('Route data - Processing product');
          Meteor.call('processOne', isin);
        }
        return product;
      }
    }
    return false;
  },
  onBeforeAction: function() {
    if (this.ready()) {
      console.log('Route onBeforeAction - Ready');
      this.next();
    } else {
      console.log('Route onBeforeAction - Loading');
      this.render('loading');
    }
  }
});

//Router.route('/profile', {
//  name: 'profile'
//});

// Reset password routes
Router.route('/resetPassword', {
  name: 'resetPassword',
  template: 'ResetPassword'
});

Router.route('/resetPassword/:token', {
  name: 'resetPasswordToken',
  template: 'ResetPasswordToken'
});

// ... (other reset password routes can be added as needed)

Router.route('/profile/:userId', {
  name: 'profile',
  data: function() {
    return Meteor.users.findOne({ _id: this.params.userId });
  },
  action: function() {
    this.render('profile');
  }
});

Router.route('/clientProducts/:userId', {
  name: 'clientProducts',
  layoutTemplate: 'mainLayout',
  waitOn() {
    return [
      Meteor.subscribe('clientProducts', this.params.userId),
      Meteor.subscribe('singleUser', this.params.userId),
      Meteor.subscribe('prices')
    ];
  },
  data() {
    const user = Meteor.users.findOne({ _id: this.params.userId });
    const userProducts = Products.find().fetch();

    return {
      user,
      userProducts
    };
  }
});

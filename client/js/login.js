import { Template } from 'meteor/templating';
import { Meteor } from 'meteor/meteor';
import { Router } from 'meteor/iron:router'; // Make sure to import Router

import '../html/login.html';

Template.login.events({
  'click #login-button'(event, template) {
    event.preventDefault();

    // Retrieve the input values
    const username = template.find('#login-username').value;
    const password = template.find('#login-password').value;

    // Call Meteor's login method
    Meteor.loginWithPassword(username, password, (error) => {
      if (error) {
        console.log('Login Error:', error.reason);
        // Handle login errors (e.g., display a message to the user)
      } else {
        console.log('Logged in successfully');
        // Redirect to the home template after successful login
        Router.go('/'); // Assuming 'home' is the name of your home route

        // If you still need to initialize App, you can do it after redirection
        Meteor.setTimeout(() => {
          if (typeof App !== 'undefined' && typeof App.init === 'function') {
            App.init();
          }
        }, 500);
      }
    });
  },

  'click #register-button'(event, template) {
    event.preventDefault();

    // Retrieve the input values
    const username = template.find('#login-username').value;
    const password = template.find('#login-password').value;

    // Create a new user account
    Accounts.createUser({ username, password }, (error) => {
      if (error) {
        console.log('Registration Error:', error.reason);
        // Handle registration errors (e.g., display a message to the user)
      } else {
        console.log('Account created successfully');
        // Redirect to the home template after successful registration
        Router.go('home'); // Assuming 'home' is the name of your home route

        // If you still need to initialize App, you can do it after redirection
        Meteor.setTimeout(() => {
          if (typeof App !== 'undefined' && typeof App.init === 'function') {
            App.init();
          }
        }, 500);
      }
    });
  }
});

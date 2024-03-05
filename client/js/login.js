
import { Template } from 'meteor/templating';
import { Meteor } from 'meteor/meteor';

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
        // Redirect to a different page or handle the login success
        console.log('Logged in successfully');

        $(document).ready(function() {
           setTimeout(function() {
             App.init();
           }, 500); // Adjust the time as necessary
         });



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
        // Redirect or handle the account creation success
        console.log('Account created successfully');


        $(document).ready(function() {
           setTimeout(function() {
             App.init();
           }, 500); // Adjust the time as necessary
         });

      }
    });
  }
});

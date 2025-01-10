import { Template } from 'meteor/templating';
import { Meteor } from 'meteor/meteor';
import { Router } from 'meteor/iron:router'; // Make sure to import Router

import '../html/login.html';

Template.login.events({
  'click #login-button'(event, template) {
    event.preventDefault();
    const button = event.currentTarget;
    button.disabled = true;
    button.querySelector('.login-text').classList.add('d-none');
    button.querySelector('.spinner-border').classList.remove('d-none');

    const username = template.find('#login-username').value;
    const password = template.find('#login-password').value;

    Meteor.loginWithPassword(username, password, (error) => {
      button.disabled = false;
      button.querySelector('.login-text').classList.remove('d-none');
      button.querySelector('.spinner-border').classList.add('d-none');

      if (error) {
        console.log('Login Error:', error.reason);
      } else {
        Router.go('/');
        // ... rest of the success code
      }
    });
  },

  'click #register-button'(event, template) {
    event.preventDefault();
    const button = event.currentTarget;
    button.disabled = true;
    button.querySelector('.register-text').classList.add('d-none');
    button.querySelector('.spinner-border').classList.remove('d-none');

    const username = template.find('#login-username').value;
    const password = template.find('#login-password').value;

    Accounts.createUser({ username, password }, (error) => {
      button.disabled = false;
      button.querySelector('.register-text').classList.remove('d-none');
      button.querySelector('.spinner-border').classList.add('d-none');

      if (error) {
        console.log('Registration Error:', error.reason);
      } else {
        Router.go('home');
        // ... rest of the success code
      }
    });
  }
});

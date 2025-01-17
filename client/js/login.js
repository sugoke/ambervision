import { Template } from 'meteor/templating';
import { Meteor } from 'meteor/meteor';
import { Router } from 'meteor/iron:router';
import { Modal } from 'bootstrap';

import '../html/login.html';

Template.login.events({
  'click #login-button'(event, template) {
    event.preventDefault();
    const button = event.currentTarget;
    button.disabled = true;
    button.querySelector('.login-text').classList.add('d-none');
    button.querySelector('.spinner-border').classList.remove('d-none');

    const email = template.find('#login-username').value.trim();
    const password = template.find('#login-password').value;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      button.disabled = false;
      button.querySelector('.login-text').classList.remove('d-none');
      button.querySelector('.spinner-border').classList.add('d-none');
      
      const errorModal = new Modal(document.getElementById('errorModal'));
      document.getElementById('errorMessage').textContent = 'Please enter a valid email address';
      errorModal.show();
      return;
    }

    Meteor.loginWithPassword(email, password, (error) => {
      button.disabled = false;
      button.querySelector('.login-text').classList.remove('d-none');
      button.querySelector('.spinner-border').classList.add('d-none');

      if (error) {
        const errorModal = new Modal(document.getElementById('errorModal'));
        document.getElementById('errorMessage').textContent = error.reason;
        errorModal.show();
      } else {
        Router.go('/');
      }
    });
  },

  'click #register-button'(event, template) {
    event.preventDefault();
    const button = event.currentTarget;
    button.disabled = true;
    button.querySelector('.register-text').classList.add('d-none');
    button.querySelector('.spinner-border').classList.remove('d-none');

    const email = template.find('#login-username').value;
    const password = template.find('#login-password').value;

    Accounts.createUser({ 
      email: email,
      password: password 
    }, (error) => {
      button.disabled = false;
      button.querySelector('.register-text').classList.remove('d-none');
      button.querySelector('.spinner-border').classList.add('d-none');

      if (error) {
        const errorModal = new Modal(document.getElementById('errorModal'));
        document.getElementById('errorMessage').textContent = error.reason;
        errorModal.show();
      } else {
        Router.go('home');
      }
    });
  },

  'click a[href="/forgot-password"]'(event) {
    event.preventDefault();
    const email = document.getElementById('login-username').value;
    
    if (!email) {
      const errorModal = new Modal(document.getElementById('errorModal'));
      document.getElementById('errorMessage').textContent = 'Please enter your email address first';
      errorModal.show();
      return;
    }

    Accounts.forgotPassword({ email }, (error) => {
      if (error) {
        console.error('Forgot password error:', error);
        const errorModal = new Modal(document.getElementById('errorModal'));
        document.getElementById('errorMessage').textContent = 'Error sending reset email. Please try again later.';
        errorModal.show();
      } else {
        const successModal = new Modal(document.getElementById('successModal'));
        document.getElementById('successMessage').textContent = 'Password reset email sent. Please check your inbox.';
        successModal.show();
      }
    });
  }
});

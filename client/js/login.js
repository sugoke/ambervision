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
        // Force reload to clear any stale states
        window.location.href = '/';
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


Template.ResetPassword.events({
  'submit #reset-password-form'(event, template) {
    event.preventDefault();
    
    const button = event.target.querySelector('button');
    button.disabled = true;
    button.querySelector('.reset-text').classList.add('d-none');
    button.querySelector('.spinner-border').classList.remove('d-none');

    const password = template.find('#new-password').value;
    const confirm = template.find('#confirm-password').value;

    if (password.length < 8) {
      $('#errorModal').modal('show');
      $('#errorMessage').text('Password must be at least 8 characters long');
      button.disabled = false;
      button.querySelector('.reset-text').classList.remove('d-none');
      button.querySelector('.spinner-border').classList.add('d-none');
      return;
    }

    if (password !== confirm) {
      $('#errorModal').modal('show');
      $('#errorMessage').text('Passwords do not match');
      button.disabled = false;
      button.querySelector('.reset-text').classList.remove('d-none');
      button.querySelector('.spinner-border').classList.add('d-none');
      return;
    }

    const token = template.data.token;

    Accounts.resetPassword(token, password, (error) => {
      button.disabled = false;
      button.querySelector('.reset-text').classList.remove('d-none');
      button.querySelector('.spinner-border').classList.add('d-none');

      if (error) {
        $('#errorModal').modal('show');
        $('#errorMessage').text(error.reason || 'Error resetting password');
      } else {
        $('#successModal').modal('show');
        $('#successModal').on('hidden.bs.modal', function () {
          Router.go('login');
        });
      }
    });
  }
});

Template.ResetPassword.onCreated(function() {
  if (!this.data.token) {
    Router.go('login');
  }
}); 
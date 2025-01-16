import { Template } from 'meteor/templating';
import { Accounts } from 'meteor/accounts-base';
import { Router } from 'meteor/iron:router';

import '../html/reset-password.html';

Template.ResetPassword.events({
  'submit #reset-password-form'(event, template) {
    event.preventDefault();
    
    const button = event.target.querySelector('button');
    button.disabled = true;
    button.querySelector('.reset-text').classList.add('d-none');
    button.querySelector('.spinner-border').classList.remove('d-none');

    const password = template.find('#new-password').value;
    const confirm = template.find('#confirm-password').value;

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
        $('#errorMessage').text('Error resetting password');
      } else {
        $('#successModal').modal('show');
        $('#successModal').on('hidden.bs.modal', function () {
          Router.go('login');
        });
      }
    });
  }
}); 
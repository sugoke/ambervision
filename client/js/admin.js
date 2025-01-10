import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { Accounts } from 'meteor/accounts-base';
import { Router } from 'meteor/iron:router';
import { ReactiveVar } from 'meteor/reactive-var';
import { Random } from 'meteor/random';
import { Session } from 'meteor/session';
import { Issuers } from '/imports/api/issuers/issuers.js';

import '../html/admin.html';

Template.admin.onCreated(function() {
  this.users = new ReactiveVar([]);
  this.subscribe('issuers');
  
  // Re-add the users initialization
  Meteor.call('admin.getUsers', (error, result) => {
    if (error) {
      showAlert('Error fetching users', 'danger');
    } else {
      this.users.set(result);
    }
  });
});

// Add helper function to show alerts
function showAlert(message, type = 'success', duration = 3000) {
  const alertContainer = document.getElementById('alertContainer');
  const alertId = Random.id();
  
  const alertHtml = `
    <div id="${alertId}" class="alert alert-${type} alert-dismissible fade show" role="alert">
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>
  `;
  
  alertContainer.insertAdjacentHTML('beforeend', alertHtml);
  
  // Auto dismiss after duration
  setTimeout(() => {
    const alert = document.getElementById(alertId);
    if (alert) {
      const bsAlert = new bootstrap.Alert(alert);
      bsAlert.close();
    }
  }, duration);
}

Template.admin.onRendered(function() {
  // Initialize modal when template is rendered
  this.modal = new bootstrap.Modal(document.getElementById('addIssuerModal'), {
    backdrop: 'static'
  });

  // Add event listener for modal hidden event
  document.getElementById('addIssuerModal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('addIssuerForm').reset();
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    Session.set('editingIssuerId', null);
  });

  // Add autorun to keep users list updated
  this.autorun(() => {
    Meteor.call('admin.getUsers', (error, result) => {
      if (!error && result) {
        this.users.set(result);
      }
    });
  });
});

// Add this function to handle confirmations
function showConfirm(message, callback) {
  const confirmModal = document.getElementById('confirmModal');
  const confirmMessage = document.getElementById('confirmMessage');
  confirmMessage.textContent = message;

  // Create new modal instance instead of getting existing one
  const modal = new bootstrap.Modal(confirmModal, {
    backdrop: 'static'
  });
  
  // Remove any existing event listener
  const confirmBtn = document.getElementById('confirmAction');
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
  // Add new event listener
  newConfirmBtn.addEventListener('click', () => {
    modal.hide();
    // Clean up modal and backdrop
    modal.dispose();
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    callback();
  });

  modal.show();
}

Template.admin.helpers({
  users() {
    return Template.instance().users.get();
  },
  formatDate(date) {
    return date ? new Date(date).toLocaleString() : 'Never';
  },
  email(user) {
    return user.username || 'No email';
  },
  role(user) {
    return user.profile?.role || 'User';
  },
  bankAccounts(user) {
    return user.profile?.bankAccounts || [];
  },
  lastLogin(user) {
    return user.createdAt ? new Date(user.createdAt).toLocaleString() : 'Never';
  },
  profileLink(userId) {
    return Router.routes['profile'].path({ userId: userId });
  },
  issuers() {
    const user = Meteor.user();
    // Only show issuers if user is superAdmin
    if (user?.profile?.role === 'superAdmin') {
      return Issuers.find({}, { sort: { name: 1 } });
    }
    return [];
  }
});

Template.admin.events({
  'click .edit-user'(event, template) {
    const userId = event.currentTarget.getAttribute('data-id');
    console.log('Edit user:', userId);
  },

  'click .delete-user'(event, template) {
    const userId = event.currentTarget.getAttribute('data-id');
    const user = Meteor.users.findOne(userId);
    
    showConfirm(`Are you sure you want to delete user "${user?.username}"?`, () => {
      Meteor.call('admin.deleteUser', userId, (error) => {
        if (error) {
          showAlert(error.message, 'danger');
        } else {
          showAlert('User deleted successfully');
          Meteor.call('admin.getUsers', (error2, result) => {
            if (!error2) {
              template.users.set(result);
            }
          });
        }
      });
    });
  },

  'submit #addUserForm'(event, template) {
    event.preventDefault();
    const email = event.target.newEmail.value;
    const role = event.target.newRole.value;
    const password = event.target.newUserPassword.value;

    Meteor.call('admin.createUser', { email, role, password }, (error) => {
      if (error) {
        showAlert(error.message, 'danger');
      } else {
        showAlert('User created successfully');
        event.target.reset();
        Meteor.call('admin.getUsers', (error2, result) => {
          if (!error2) {
            template.users.set(result);
          }
        });
      }
    });
  },

  'submit #uploadExcelForm'(event) {
    event.preventDefault();
    
    const file = document.getElementById('excelFile').files[0];
    if (!file) {
      showAlert('Please select a file', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const text = e.target.result;
        const rows = text.split('\n');
        
        const pricesData = rows.slice(1)
          .filter(row => row && row.trim().length > 0)
          .map(row => {
            try {
              const [isin, bid] = row.split(';');
              if (!isin || !bid) {
                console.log('Skipping invalid row:', row);
                return null;
              }
              return { 
                isin: isin.trim(),
                bid: parseFloat(bid.trim().replace(',', '.'))
              };
            } catch (err) {
              console.log('Error processing row:', row, err);
              return null;
            }
          })
          .filter(item => item !== null && !isNaN(item.bid));

        if (pricesData.length === 0) {
          document.getElementById('uploadMessage').innerHTML = 
            '<div class="alert alert-danger">No valid data found in file</div>';
          return;
        }

        console.log('Processed data:', pricesData);
        Meteor.call('updatePrices', pricesData, (error, result) => {
          if (error) {
            showAlert(error.message, 'danger');
          } else {
            showAlert(`Prices updated successfully: ${result.updated} records`);
            document.getElementById('uploadExcelForm').reset();
          }
        });
      } catch (err) {
        showAlert('Error processing file', 'danger');
      }
    };

    reader.onerror = function(err) {
      showAlert('Error reading file', 'danger');
    };

    reader.readAsText(file);
  },

  'click .client-row'(event) {
    // Don't trigger if clicking buttons
    if ($(event.target).closest('.btn').length) {
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    const clientId = $(event.currentTarget).data('id');
    Router.go('profile', { userId: clientId });
  },

  'click #clientBanner .btn-close'(event) {
    $('#clientBanner').fadeOut();
    Session.set('selectedClientId', null);
    if (window.productsTable) {
      window.productsTable.ajax.reload();
    }
  },

  'click #saveIssuer'(event, template) {
    event.preventDefault();
    const name = document.getElementById('issuerName').value.trim();
    
    if (name) {
      Meteor.call('addIssuer', name, (error) => {
        if (error) {
          showAlert(error.message, 'danger');
        } else {
          showAlert('Issuer added successfully');
          template.modal.hide();
        }
      });
    } else {
      showAlert('Please enter an issuer name', 'warning');
    }
  },

  'click .delete-issuer'(event) {
    event.preventDefault();
    const issuerId = event.currentTarget.dataset.id;
    const issuer = Issuers.findOne(issuerId);
    
    showConfirm(`Are you sure you want to delete issuer "${issuer?.name}"?`, () => {
      Meteor.call('deleteIssuer', issuerId, (error) => {
        if (error) {
          showAlert(error.message, 'danger');
        } else {
          showAlert('Issuer deleted successfully');
        }
      });
    });
  },

  'click .edit-issuer'(event, template) {
    event.preventDefault();
    const issuerId = event.currentTarget.dataset.id;
    const issuer = Issuers.findOne(issuerId);
    
    if (issuer) {
      document.getElementById('issuerName').value = issuer.name;
      Session.set('editingIssuerId', issuerId);
      template.modal.show();
    } else {
      showAlert('Issuer not found', 'danger');
    }
  }
});

Template.admin.onDestroyed(function() {
  if (this.modal) {
    this.modal.dispose();
  }
  document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
  Session.set('selectedClientId', null);
  Session.set('editingIssuerId', null);
});


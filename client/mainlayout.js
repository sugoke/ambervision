import { Template } from 'meteor/templating';
import { Router } from 'meteor/iron:router';

import './mainlayout.html';

// Add this debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

Template.registerHelper('eq', function (a, b) {
  return a === b;
});

Template.mainLayout.onCreated(function() {
  this.autorun(() => {
    const selectedClientId = Session.get('selectedClientId');
    if (selectedClientId) {
      this.subscribe('clientFilteredProducts', selectedClientId);
    }
  });
});

Template.mainLayout.helpers({
  currentUser: function() {
    return Meteor.user();
  },
  isSuperAdmin: function() {
    try {
      const user = Meteor.user();
      if (!user || !user.profile) return false;
      return user.profile.role === 'superAdmin';
    } catch (err) {
      console.error('Error in isSuperAdmin helper:', err);
      return false;
    }
  },
  selectedClientName() {
    return Session.get('selectedClientName');
  }
});

Template.mainLayout.events({
  'click #refreshButton'(event) {
    event.preventDefault();  // Prevent default anchor behavior

    Meteor.call('updateAllMarketData', (error, result) => {
      if (error) {
        console.error("Error calling updateAllMarketData:", error);
      } else {
        console.log("Products updated successfully");
        console.log(result);

        // Additional success logic
      }
    });
  },

  'click .logout'(event) {
    event.preventDefault();
    Meteor.logout(() => {
      Router.go('/login');
    });
  },

  'input #clientSearch': debounce(function(event) {
    const searchTerm = event.target.value.trim();
    const resultsDiv = document.getElementById('searchResults');
    const resultsList = document.getElementById('searchResultsList');

    if (searchTerm.length < 2) {
      resultsDiv.classList.add('d-none');
      return;
    }

    // Call server method to search users
    Meteor.call('searchClients', searchTerm, (error, results) => {
      if (error) {
        console.error('Error searching users:', error);
        return;
      }

      resultsList.innerHTML = '';
      
      if (results.length === 0) {
        resultsList.innerHTML = '<div class="list-group-item bg-dark text-white-50">No results found</div>';
      } else {
        results.forEach(user => {
          const item = document.createElement('div');
          item.className = 'list-group-item list-group-item-action bg-dark text-white border-secondary';
          
          let accountsHtml = '';
          if (user.bankAccounts && user.bankAccounts.length > 0) {
            accountsHtml = user.bankAccounts.map(account => 
              `<div class="small text-white-50">
                <i class="bi bi-bank me-1"></i>${account.bank} - ${account.accountNumber}
               </div>`
            ).join('');
          }
          
          // Highlight matching text
          const username = user.username.replace(
            new RegExp(searchTerm, 'gi'),
            match => `<span class="text-warning">${match}</span>`
          );
          
          item.innerHTML = `
            <div class="d-flex flex-column">
              <div class="fw-bold">${username}</div>
              ${accountsHtml}
            </div>
          `;

          // Add hover effect
          item.addEventListener('mouseenter', () => {
            item.classList.add('bg-primary');
          });
          item.addEventListener('mouseleave', () => {
            item.classList.remove('bg-primary');
          });

          item.onclick = () => {
            const clientId = user._id;
            console.log('Selected client:', {
              username: user.username,
              userId: clientId
            });
            
            Session.set('selectedClientName', user.username);
            Session.set('selectedClientId', clientId);
          };

          resultsList.appendChild(item);
        });
      }
      
      resultsDiv.classList.remove('d-none');
    });
  }, 300),

  'keydown #clientSearch': function(event) {
    const resultsDiv = document.getElementById('searchResults');
    const resultsList = document.getElementById('searchResultsList');
    const items = resultsList.getElementsByTagName('a');
    let currentIndex = -1;

    // Find currently focused item
    for (let i = 0; i < items.length; i++) {
      if (items[i].classList.contains('bg-primary')) {
        currentIndex = i;
        break;
      }
    }

    switch(event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (currentIndex < items.length - 1) {
          if (currentIndex >= 0) items[currentIndex].classList.remove('bg-primary');
          items[currentIndex + 1].classList.add('bg-primary');
          items[currentIndex + 1].scrollIntoView({ block: 'nearest' });
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (currentIndex > 0) {
          items[currentIndex].classList.remove('bg-primary');
          items[currentIndex - 1].classList.add('bg-primary');
          items[currentIndex - 1].scrollIntoView({ block: 'nearest' });
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (currentIndex >= 0) {
          window.location.href = items[currentIndex].href;
        }
        break;
      case 'Escape':
        resultsDiv.classList.add('d-none');
        event.target.blur();
        break;
    }
  },

  'blur #clientSearch': function(event) {
    setTimeout(() => {
      document.getElementById('searchResults').classList.add('d-none');
    }, 200);
  },

  'focus #clientSearch': function(event) {
    if (event.target.value.trim().length >= 2) {
      document.getElementById('searchResults').classList.remove('d-none');
    }
  },

  'click #updateMarketDataBtn'(event) {
    event.preventDefault();
    Meteor.call('updateMarketData', (error, result) => {
      if (error) {
        console.error('Error calling updateLiveMarketData:', error);
      } else {
        console.log('updateLiveMarketData method called successfully');
      }
    });
  },

  'click #processBtn'(event) {
    event.preventDefault();
    Meteor.call('process', (error, result) => {
      if (error) {
        console.error('Error processing Phoenix products:', error);
      } else {
        result.forEach(product => {
          console.log(`Product: ${product.name} (${product.ISINCode})`);
          console.table(product.observations);
        });
      }
    });
  },

  'click #riskBtn'(event) {
    event.preventDefault();
    Meteor.call('risk', (error, result) => {
      if (error) {
        console.error('Error running risk method:', error);
      } else {
        console.log('Risk method result:', result);
      }
    });
  },

  'click #schedulesBtn'(event) {
    event.preventDefault();
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generating...';
    btn.disabled = true;

    Meteor.call('generateUserSchedule', Meteor.userId(), (error, result) => {
      btn.disabled = false;
      btn.innerHTML = originalText;
      
      if (error) {
        console.error('Error generating schedule:', error);
        alert('Error generating schedules. Please try again.');
      } else {
        console.log('Schedules generated:', result);
      }
    });
  },

  'click #removeClientFilter'(event) {
    Session.set('selectedClientName', null);
    Session.set('selectedClientId', null);
  },

  'click #confirmLogout'(event) {
    event.preventDefault();
    
    // First hide the modal properly
    const modalElement = document.getElementById('logoutModal');
    const modal = bootstrap.Modal.getInstance(modalElement);
    modal.hide();
    
    // Remove modal backdrops
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.remove();
    });
    
    // Remove modal-open class from body
    document.body.classList.remove('modal-open');
    
    // Clear any session variables
    Session.keys = {};
    
    // Finally logout
    Meteor.logout(() => {
      Router.go('/login');
    });
  }
});

Template.mainLayout.onRendered(function() {
  Tracker.autorun(() => {
    const user = Meteor.user();
    console.log('Current user details:', {
      id: user?._id,
      username: user?.username,
      role: user?.role,
      fullUser: user
    });
  });

  // Initialize Bootstrap components
  const initBootstrapComponents = () => {
    // Initialize tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));

    // Initialize popovers
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    popoverTriggerList.forEach(el => new bootstrap.Popover(el));

    // Initialize dropdowns
    const dropdownElementList = [].slice.call(document.querySelectorAll('.dropdown-toggle'));
    dropdownElementList.forEach(el => new bootstrap.Dropdown(el));

    // Initialize collapse elements
    const collapseElementList = [].slice.call(document.querySelectorAll('.collapse'));
    collapseElementList.forEach(el => new bootstrap.Collapse(el, { toggle: false }));
  };

  // Run initialization
  initBootstrapComponents();

  // Re-run when user changes
  this.autorun(() => {
    const user = Meteor.user();
    Tracker.afterFlush(() => {
      initBootstrapComponents();
    });
  });
});

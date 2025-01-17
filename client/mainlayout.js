import { Template } from 'meteor/templating';
import { Router } from 'meteor/iron:router';
import { Products } from '/imports/api/products/products.js';
import { ReactiveVar } from 'meteor/reactive-var';

import './mainlayout.html';

// Global loading state
export const globalLoading = new ReactiveVar(true);

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
  this.userReady = new ReactiveVar(false);
  
  // Add your existing subscription autorun
  this.autorun(() => {
    const selectedClientId = Session.get('selectedClientId');
    if (selectedClientId) {
      this.subscribe('clientFilteredProducts', selectedClientId);
    }
  });
  
  // Add subscription for product search
  this.searchQuery = new ReactiveVar('');
  this.autorun(() => {
    const query = this.searchQuery.get();
    if (query && query.length >= 2) {
      this.subscribe('searchProducts', query);
    }
  });
  
  // Track loading state - remove FlowRouter reference
  this.autorun(() => {
    const subsReady = Iron.controller()?.ready() ?? false;
    const userReady = this.userReady.get();
    const allDataLoaded = subsReady && userReady;
    
    globalLoading.set(!allDataLoaded);
  });
});

Template.mainLayout.helpers({
  currentUser: function() {
    return Meteor.user();
  },
  isSuperAdmin() {
    const instance = Template.instance();
    const user = Meteor.user();
    return instance.userReady.get() && user?.profile?.role === 'superAdmin';
  },
  selectedClientName() {
    return Session.get('selectedClientName');
  },
  searchResults() {
    const query = Template.instance().searchQuery.get();
    if (!query || query.length < 2) return [];
    
    const regex = new RegExp(query, 'i');
    return Products.find({
      $or: [
        { ISINCode: regex },
        { 'genericData.name': regex },
        { 'underlyings.ticker': regex },
        { 'underlyings.name': regex }
      ]
    }, { limit: 10 }).map(product => ({
      ...product,
      matchedField: 
        (product.ISINCode && product.ISINCode.match(regex)) ? 'ISIN' :
        (product.genericData?.name && product.genericData.name.match(regex)) ? 'Name' :
        (product.underlyings?.some(u => u.ticker?.match(regex))) ? 'Ticker' :
        'Underlying'
    }));
  },
  isLoading() {
    return globalLoading.get();
  }
});

// Add these helper functions at the top of the file
const showLoading = () => {
  document.getElementById('loadingBackdrop').classList.remove('d-none');
};

const hideLoading = () => {
  document.getElementById('loadingBackdrop').classList.add('d-none');
};

Template.mainLayout.events({
  'click #refreshButton'(event) {
    event.preventDefault();
    showLoading();
    Meteor.call('updateAllMarketData', (error, result) => {
      hideLoading();
      if (error) {
        console.error("Error calling updateAllMarketData:", error);
      } else {
        console.log("Products updated successfully");
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
    showLoading();
    Meteor.call('updateMarketData', (error, result) => {
      hideLoading();
      if (error) {
        console.error('Error calling updateLiveMarketData:', error);
      } else {
        console.log('updateLiveMarketData method called successfully');
      }
    });
  },

  'click #processBtn'(event) {
    event.preventDefault();
    showLoading();
    Meteor.call('process', (error, result) => {
      hideLoading();
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
    showLoading();
    Meteor.call('risk', (error, result) => {
      hideLoading();
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
    showLoading();

    Meteor.call('generateUserSchedule', Meteor.userId(), (error, result) => {
      hideLoading();
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
  },

  'click .app-sidebar-mobile-backdrop'(event) {
    document.querySelector('.app').classList.remove('app-sidebar-mobile-toggled');
  },

  'click .menu-link'(event, template) {
    // Close sidebar when menu item is clicked on mobile
    if (window.innerWidth <= 767) {
      document.querySelector('.app').classList.remove('app-sidebar-mobile-toggled');
    }
  },

  'input .menu-search input': debounce(function(event, template) {
    const query = event.target.value.trim();
    template.searchQuery.set(query.length >= 2 ? query : '');
  }, 300),

  'click .search-result-item'(event) {
    const isin = event.currentTarget.dataset.isin;
    if (isin) {
      // Close the search dropdown
      const app = document.querySelector('.app');
      app.classList.remove('app-header-menu-search-toggled');
      
      // Clear search and hide results
      const searchInput = document.querySelector('.menu-search input');
      if (searchInput) {
        searchInput.value = '';
        Template.instance().searchQuery.set('');
      }
      
      Router.go(`/productDetails?isin=${isin}`);
    }
  },

  'keydown .menu-search input'(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      const searchInput = event.target;
      searchInput.value = '';
      Template.instance().searchQuery.set('');
      searchInput.blur();
    }
    // Prevent form submission
    if (event.key === 'Enter') {
      event.preventDefault();
    }
  },

  'blur .menu-search input'(event, template) {
    // Delay hiding results slightly to allow click events to register
    Meteor.setTimeout(() => {
      template.searchQuery.set('');
    }, 200);
  }
});

Template.mainLayout.onRendered(function() {
  // Add user tracking
  this.autorun(() => {
    const user = Meteor.user();
    
    if (!Meteor.loggingIn() && user) {
      this.userReady.set(true);
      const userRole = user.profile?.role;
      
      console.log('Current user details:', {
        id: user._id,
        username: user.username,
        role: userRole,
        profile: { role: userRole },
        fullUser: user,
        ready: true
      });
    }
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

  // Prevent body scrolling when sidebar is open on mobile
  const toggleBodyScroll = (shouldPreventScroll) => {
    document.body.classList.toggle('no-scroll', shouldPreventScroll);
  };

  // Handle mobile menu toggle
  const mobileToggler = document.querySelector('.mobile-toggler .menu-toggler');
  if (mobileToggler) {
    mobileToggler.addEventListener('click', function(e) {
      e.preventDefault();
      const app = document.querySelector('.app');
      const isOpening = !app.classList.contains('app-sidebar-mobile-toggled');
      app.classList.toggle('app-sidebar-mobile-toggled');
      toggleBodyScroll(isOpening);
    });
  }

  // Close sidebar when clicking outside
  document.addEventListener('click', function(e) {
    if (window.innerWidth <= 767) {
      const sidebar = document.querySelector('.app-sidebar');
      const toggler = document.querySelector('.mobile-toggler');
      if (!sidebar.contains(e.target) && !toggler.contains(e.target)) {
        document.querySelector('.app').classList.remove('app-sidebar-mobile-toggled');
        toggleBodyScroll(false);
      }
    }
  });

  // Handle window resize
  window.addEventListener('resize', function() {
    if (window.innerWidth > 767) {
      document.querySelector('.app').classList.remove('app-sidebar-mobile-toggled');
      toggleBodyScroll(false);
    }
  });
});

// Add these Iron Router hooks
Router.configure({
  onBeforeAction: function() {
    globalLoading.set(true);
    this.next();
  },
  onAfterAction: function() {
    Tracker.afterFlush(() => {
      const subsReady = this.ready();
      if (subsReady) {
        Meteor.setTimeout(() => {
          globalLoading.set(false);
        }, 100);
      }
    });
  }
});

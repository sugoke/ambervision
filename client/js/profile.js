import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { Accounts } from 'meteor/accounts-base';
import { Router } from 'meteor/iron:router';
import { Products } from '/imports/api/products/products.js';
import { Holdings } from '/imports/api/products/products.js';
import { isSuperAdmin } from '/lib/helpers.js';
import '../html/profile.html';
import { Random } from 'meteor/random';
import { ReactiveVar } from 'meteor/reactive-var';
import { TabularTables } from '/imports/tabular-tables.js';

let renderCount = 0;

Template.profile.onCreated(function() {
  console.log('Profile template created');
  
  // Initialize ReactiveVars
  this.showSuggestions = new ReactiveVar(false);
  this.isinSuggestions = new ReactiveVar([]);

  // Subscribe to users if superAdmin
  this.autorun(() => {
    console.log('Checking superAdmin for subscription:', isSuperAdmin());
    if (isSuperAdmin()) {
      console.log('Subscribing to allUsers');
      this.subscribe('allUsers');
    }
  });

  this.autorun(() => {
    const userId = Router.current().params.userId;
    if (userId) {
      const subscription = this.subscribe('singleUser', userId);
      if (subscription.ready()) {
        const user = Meteor.users.findOne(userId);
        console.log('User data loaded:', {
          userId,
          username: user?.username,
          bankAccounts: user?.profile?.bankAccounts
        });
      }
    }
  });
});

Template.profile.onRendered(function() {
  console.log('Profile template rendered');
  
  renderCount++;
  console.log(`Profile template rendered (count: ${renderCount})`);
  this.$('#purchasePrice').val('100.00');
  
  // Log the current reactive dependencies
  this.autorun(() => {
    console.log('Reactive dependencies in profile template:', Tracker.currentComputation.dependencies);
  });
  
  this.autorun(() => {
    const userId = Meteor.userId();
    console.log('Current user ID in autorun:', userId);
    
    if (Meteor.userId()) {
      console.log('All subscriptions are ready');
      
      const holdings = Holdings.find({ userId: userId }).fetch();
      console.log('Holdings found:', holdings.length);
      
      const isins = holdings.map(h => h.isin);
      const products = Products.find({ 'genericData.ISINCode': { $in: isins } }).fetch();
      console.log('Products found:', products.length);
      
      if (products.length === 0) {
        console.log('No products found. Check if the data is being published.');
      }
    } else {
      console.log('User not logged in');
    }
  });

  // Simple input event listener for ISIN autocomplete
  const isinInput = this.$('#ISINCode');
  const productIdInput = this.$('#productId');
  
  isinInput.on('input', function() {
    const searchTerm = this.value.trim();
    console.log('Search term:', searchTerm);
    
    if (searchTerm.length >= 2) {
      console.log('Calling searchProducts method');
      Meteor.call('searchProducts', searchTerm, (error, results) => {
        if (error) {
          console.error("Error in autocomplete:", error);
        } else {
          console.log('Received results:', results);
          const suggestionsList = results.map(item => `
            <li data-isin="${item.genericData.ISINCode}" data-product-id="${item._id}" data-currency="${item.genericData.currency}">
              <strong>${item.genericData.ISINCode}</strong> - ${item.genericData.name}<br>
              <small>${item.genericData.issuer} | ${item.genericData.currency}</small>
            </li>
          `).join('');
          
          console.log('Suggestions list:', suggestionsList);
          $('#isinSuggestions').html(`<ul>${suggestionsList}</ul>`);
          $('#isinSuggestions').show();
        }
      });
    } else {
      $('#isinSuggestions').hide();
    }
  });

  $(document).on('click', '#isinSuggestions li', function() {
    const selectedIsin = $(this).data('isin');
    const selectedProductId = $(this).data('product-id');
    const selectedCurrency = $(this).data('currency'); // Add this line
    isinInput.val(selectedIsin);
    productIdInput.val(selectedProductId);
    $('#currency').val(selectedCurrency); // Add this line to set the currency
    $('#isinSuggestions').hide();
  });
});

Template.profile.helpers({
  isinSuggestions() {
    return Template.instance().isinSuggestions.get();
  },
  showSuggestions() {
    return Template.instance().showSuggestions.get();
  },
  userLoaded() {
    const user = Meteor.user();
    console.log('User loaded check:', user);
    return !!user;
  },
  allUsers() {
    console.log('Checking superAdmin status:', isSuperAdmin());
    if (isSuperAdmin()) {
      const users = Meteor.users.find({}, { fields: { username: 1 } }).fetch();
      console.log('Found users:', users);
      return users;
    }
    return [];
  },
  currentUserEmail() {
    const user = Meteor.user();
    return user && user.emails && user.emails[0].address;
  },
  profileData() {
    const userId = Router.current().params.userId;
    
    const user = Meteor.users.findOne(userId);

    if (!user) {
      console.log('User not found.');
    }
    
    return user;
  },
  
  bankAccounts() {
    const userId = Router.current().params.userId;
    const user = Meteor.users.findOne(userId);
    const accounts = user?.profile?.bankAccounts || [];
    console.log('Bank accounts helper:', {
      userId,
      userFound: !!user,
      accountsCount: accounts.length,
      accounts
    });
    return accounts;
  },
  
  formatBankAccount(account) {
    console.log('Formatting account number:', account);
    if (!account) return '';
    return account.replace(/(\d{4})/g, '$1 ').trim();
  },
  
  productsTableData() {
    console.log('productsTableData helper called');
    const userId = Meteor.userId();
    console.log('Current user ID:', userId);
    
    const holdings = Holdings.find({ userId: userId }).fetch();
    console.log('User holdings:', holdings);
    
    const isins = holdings.map(h => h.isin);
    console.log('User ISINs:', isins);
    
    const products = Products.find({ ISINCode: { $in: isins } }).fetch();
    console.log('Products to display:', products);
    
    if (products.length === 0) {
      console.log('No products found for display');
    }
    
    return products;
  },
  getCurrency(isin) {
    const product = Products.findOne({ 'genericData.ISINCode': isin });
    return product ? product.genericData.currency : '';
  }
});

Template.profile.events({
  'input #isin'(event, template) {
    const input = event.target.value.trim();
    
    console.log('Input value:', input);
    
    if (input.length > 2) {
      template.showSuggestions.set(true);
      console.log('Searching products for:', input);
      Meteor.call('searchProducts', input, (error, results) => {
        if (error) {
          console.error('Error searching products:', error);
        } else {
          console.log('Received suggestions:', results);
          if (results.length === 0) {
            console.log('No suggestions found in the database');
          } else {
            console.log('Suggestion details:', results.map(r => ({
              ISIN: r.genericData.ISINCode,
              Name: r.genericData.name,
              Currency: r.genericData.currency
            })));
          }
          template.isinSuggestions.set(results);
        }
      });
    } else {
      template.isinSuggestions.set([]);
      template.showSuggestions.set(false);
    }
  },
  
  'click .autocomplete-suggestion'(event, template) {
    const selectedIsin = event.target.dataset.isin;
    const selectedCurrency = event.target.dataset.currency;
    console.log('Suggestion clicked:', selectedIsin, 'Currency:', selectedCurrency);
    template.$('#isin').val(selectedIsin);
    template.$('#currency').val(selectedCurrency);
    template.$('#isinSuggestions').hide();
  },
  
  'click .isin-suggestion': function(event, template) {
    const selectedIsin = event.currentTarget.getAttribute('data-isin');
    const selectedCurrency = event.currentTarget.getAttribute('data-currency');
    
    // Set the ISIN input value
    template.find('#ISINCode').value = selectedIsin;
    
    // Set the currency input value
    template.find('#currency').value = selectedCurrency;
    
    // Hide the suggestions
    template.$('#isinSuggestions').hide();
  },
  
  'blur #isin'(event, template) {
    // Hide suggestions when the input loses focus
    Meteor.setTimeout(() => {
      template.showSuggestions.set(false);
    }, 200);
  },
  
  'focus #isin'(event, template) {
    // Show suggestions if there's content and length > 2
    const input = event.target.value.trim();
    if (input.length > 2) {
      template.showSuggestions.set(true);
    }
  },
  
  'input #amount'(event) {
    let value = event.target.value.replace(/[^\d.]/g, '');
    
    const parts = value.split('.');
    if (parts.length > 2) {
      parts.pop();
      value = parts.join('.');
    }
    
    const wholePart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    
    event.target.value = parts.length > 1 ? `${wholePart}.${parts[1]}` : wholePart;
  },
  
  'blur #amount'(event) {
    const value = parseFloat(event.target.value.replace(/,/g, ''));
    if (!isNaN(value)) {
      if (Number.isInteger(value)) {
        // If it's a whole number, don't add decimal places
        event.target.value = value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      } else {
        // If it has decimal places, format to two decimal places
        event.target.value = value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      }
    }
  },
  
  'input #purchasePrice'(event) {
    let value = event.target.value.replace(/[^\d.]/g, '');
    
    const parts = value.split('.');
    if (parts.length > 2) {
      parts.pop();
      value = parts.join('.');
    }
    
    // Limit to two decimal places
    if (parts[1] && parts[1].length > 2) {
      parts[1] = parts[1].substring(0, 2);
    }
    
    event.target.value = parts.join('.');
  },
  
  'blur #purchasePrice'(event) {
    const value = parseFloat(event.target.value);
    if (!isNaN(value)) {
      event.target.value = value.toFixed(2);
    } else {
      event.target.value = '100.00';
    }
  },
  
  'submit #addInstrumentForm'(event, template) {
    event.preventDefault();
    console.log('Form submitted');
    
    // Get the userId from the URL parameter instead of current user
    const displayedUserId = Router.current().params.userId;
    console.log('Adding instrument for user:', displayedUserId);
    
    // If admin, use the selected user, otherwise use the displayed user ID
    const targetUserId = isSuperAdmin() ? ($('#targetUser').val() || displayedUserId) : displayedUserId;
    console.log('Target user ID:', targetUserId);
    
    const formData = {
      userId: targetUserId,  // This will now be the correct user ID
      isin: $('#ISINCode').val(),
      productId: $('#productId').val(),
      quantity: parseFloat($('#amount').val().replace(/,/g, '')),
      purchasePrice: parseFloat($('#purchasePrice').val()),
      purchaseDate: new Date($('#purchaseDate').val()),
      bankAccountId: $('#bankAccount').val()
    };

    console.log('Form data:', formData);

    Meteor.call('holdings.insert', formData, (error, result) => {
      if (error) {
        console.error('Error adding holding:', error);
        alert('Error adding holding: ' + error.reason);
      } else {
        console.log('Holding added successfully:', result);
        
        // Properly close the modal and clean up
        const modal = bootstrap.Modal.getInstance(document.getElementById('addInstrumentModal'));
        if (modal) {
          modal.hide();
        }
        
        // Remove all modal backdrops
        $('.modal-backdrop').remove();
        
        // Remove modal-open class and inline styles from body
        $('body').removeClass('modal-open').css({
          'overflow': '',
          'padding-right': ''
        });
        
        template.find('#addInstrumentForm').reset();
      }
    });
  },
  
  'invalid #amount'(event) {
    event.preventDefault();
  },
  'click .delete-account': function(event) {
    event.preventDefault();
    
    // Debugging logs
    console.log('Event:', event);
    console.log('Event currentTarget:', event.currentTarget);
    console.log('Event target:', event.target);
    
    const accountId = event.currentTarget.getAttribute('data-id');
    console.log('Account ID:', accountId); // Check if this logs the correct ID

    const displayedUserId = Router.current().params.userId;

    if (accountId && confirm('Are you sure you want to delete this bank account?')) {
      Meteor.call('removeBankAccount', accountId, displayedUserId, (error, result) => {
        if (error) {
          alert('Error removing bank account: ' + error.reason);
        } else {
          alert('Bank account removed successfully.');
        }
      });
    } else {
      alert('Account ID is missing or invalid.');
    }
  },
  
  'click #addBankAccountBtn': function(event, template) {
    console.log('Add Bank Account button clicked');
    event.preventDefault();

    const displayedUserId = Router.current().params.userId;
    console.log('Displayed User ID:', displayedUserId);

    // Log the template instance to check if it's correctly defined
    console.log('Template instance:', template);

    // Use try-catch to handle potential errors when finding elements
    try {
      const bank = template.find('#bank').value;
      const country = template.find('#country').value;
      const accountNumber = template.find('#accountNumber').value;
      const refCurrency = template.find('#refCurrency').value;

      console.log('Form values:', { bank, country, accountNumber, refCurrency });

      if (bank && country && accountNumber && refCurrency) {
        console.log('All fields are filled, calling Meteor method');
        Meteor.call('user.addBankAccount', displayedUserId, bank, country, accountNumber, refCurrency, (error, result) => {
          if (error) {
            console.error('Error adding bank account:', error);
            alert('Error adding bank account: ' + error.reason);
          } else {
            console.log('Bank account added successfully:', result);
            alert('Bank account added successfully');
            // Clear the input fields after adding the new row
            try {
              template.find('#bank').value = '';
              template.find('#country').value = '';
              template.find('#accountNumber').value = '';
              template.find('#refCurrency').value = '';
              console.log('Form fields cleared');
            } catch (clearError) {
              console.error('Error clearing form fields:', clearError);
            }
          }
        });
      } else {
        console.warn('Missing form fields');
        alert('Please fill in all fields.');
      }
    } catch (error) {
      console.error('Error accessing form elements:', error);
      alert('An error occurred while processing the form. Please check the console for details.');
    }
  },
});

import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import '../../html/templates/underlyingRow.html';
import moment from 'moment';

console.log('Loading underlyingRow.js');

Template.underlyingRow.onCreated(function() {
  console.log('underlyingRow template created, template instance:', this);
  // Store the template instance
  this.templateInstance = this;
});

Template.underlyingRow.onRendered(function() {
  console.log('underlyingRow template rendered');
  const templateInstance = this;
  
  // Use Tracker.afterFlush to ensure DOM is ready
  Tracker.afterFlush(() => {
    const row = templateInstance.$('tr');
    console.log('Row found:', row.length > 0);
    
    const inputs = row.find('input.fullName-autocomplete, input.ticker-autocomplete');
    console.log('Inputs found:', inputs.length);
    
    inputs.each(function() {
      const inputElement = $(this);

      // Initialize autocomplete
      inputElement.autocomplete({
        source(request, response) {
          Meteor.call('tickers.autocomplete', request.term, (err, result) => {
            if (err) {
              console.log('Autocomplete error:', err);
              response([]);
            } else {
              const data = result.map(item => ({
                label: `${item.Name} (${item.Code}.${item.Exchange})`,
                value: item.Name,
                data: item
              }));
              response(data);
            }
          });
        },
        minLength: 2,
        select(event, ui) {
          console.log('DEBUG: select event triggered');
          console.log('DEBUG: ui.item:', ui.item);
          const selectedData = ui.item.data;
          const rowId = inputElement.closest('tr').data('row-id');

          // Update fields
          $(`#fullNameInput-${rowId}`).val(selectedData.Name);
          $(`#tickerInput-${rowId}`).val(selectedData.Code);
          $(`#exchangeInput-${rowId}`).val(selectedData.Exchange);
          $(`#countryInput-${rowId}`).val(selectedData.Country);
          $(`#currencyInput-${rowId}`).val(selectedData.Currency);

          // Fetch last price
          console.log(`Fetching price for ${selectedData.Code}.${selectedData.Exchange}`);
          Meteor.call('getTickerLastPrice', `${selectedData.Code}.${selectedData.Exchange}`, (err, result) => {
            if (err) {
              console.error('Error fetching price:', err);
            } else {
              console.log('Price data received:', result);
              const formattedDate = moment.unix(result.date).format('DD/MM/YYYY HH:mm');
              $(`#closeText-${rowId}`).text(`${result.close} (${formattedDate})`);
            }
          });
        }
      });
    });
  });
});

// Separate event map for clarity
const eventMap = {
  'input .fullName-autocomplete'(event, template) {
    const value = event.target.value;
    const rowId = $(event.target).data('row-id');
    console.log('Fullname input event - Value:', value, 'Row ID:', rowId, 'Element:', event.target);
    event.stopPropagation();
  },
  
  'input .ticker-autocomplete'(event, template) {
    console.log('Ticker input event:', event.target.value);
    event.stopPropagation();
  },
  
  'focus .fullName-autocomplete, focus .ticker-autocomplete'(event, template) {
    console.log('Focus event:', event.target.id);
    event.stopPropagation();
  },
  
  'click input'(event, template) {
    console.log('Click on input:', event.target.id);
    event.stopPropagation();
  },
  
  'autocompleteselect .ticker-autocomplete'(event, instance, doc) {
    console.log("DEBUG: autocompleteselect triggered");
    console.log("DEBUG: selected doc:", doc);
    console.log("DEBUG: event:", event);
    console.log("DEBUG: instance data:", instance.data);

    // Populate fields here with doc data if needed, e.g.:
    // instance.$('#fullNameInput-' + instance.data.id).val(doc.fullName);
    // instance.$('#exchangeInput-' + instance.data.id).val(doc.exchange);
  }
};

Template.underlyingRow.events(eventMap);

// Add helper to verify data context
Template.underlyingRow.helpers({
  debug() {
    console.log('Template data context:', Template.currentData());
    return '';
  },
  
  inputAttributes() {
    return {
      class: 'form-control fullName-autocomplete',
      autocomplete: 'off',
      'data-row-id': Template.currentData().id
    };
  }
}); 
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
                label: `${item.Code}.${item.Exchange} | ${item.Name} | ${item.Type} | ${item.Currency} ${item.Country} | ${item.previousClose} (${item.previousCloseDate})`,
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
          const tradeDate = $('#tradeDate').val();

          // Update fields
          $(`#fullNameInput-${rowId}`).val(selectedData.Name);
          $(`#tickerInput-${rowId}`).val(selectedData.Code);
          $(`#exchangeInput-${rowId}`).val(selectedData.Exchange);
          $(`#countryInput-${rowId}`).val(selectedData.Country);
          $(`#currencyInput-${rowId}`).val(selectedData.Currency);

          // Set the latest close price from autocomplete data
          $(`#closeText-${rowId}`).text(`${selectedData.previousClose} (${selectedData.previousCloseDate})`);

          // If trade date is set, fetch historical price for strike
          if (tradeDate) {
            const ticker = `${selectedData.Code}.${selectedData.Exchange}`;
            console.log(`Fetching historical price for ${ticker} on trade date: ${tradeDate}`);
            
            toggleStrikeLoading(rowId, true);
            
            Meteor.call('getTickerInfo', ticker, tradeDate, (err, result) => {
              toggleStrikeLoading(rowId, false);
              if (err) {
                console.error('Error fetching historical price:', err);
              } else {
                console.log('Historical price data received:', result);
                if (result.lastPrice) {
                  $(`#strikeInput-${rowId}`).val(result.lastPrice);
                  console.log(`Strike price set to ${result.lastPrice} for trade date ${result.date}`);
                } else {
                  console.warn(`No historical price found for ${ticker} on ${tradeDate}`);
                }
              }
            });
          } else {
            console.warn('No trade date selected, cannot fetch historical price for strike');
          }
        },
        html: true,
        classes: {
          "ui-autocomplete": "highlight"
        },
        position: {
          my: "left top+2",
          at: "left bottom",
          collision: "flip"
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
  },
  
  'change #tradeDate'(event) {
    const newTradeDate = event.target.value;
    console.log('Trade date changed to:', newTradeDate);
    
    $('#underlyingRowsContainer tr').each(function() {
      const rowId = $(this).data('row-id');
      const ticker = $(`#tickerInput-${rowId}`).val();
      const exchange = $(`#exchangeInput-${rowId}`).val();
      
      if (ticker && exchange) {
        console.log(`Updating strike price for ${ticker}.${exchange} on new trade date: ${newTradeDate}`);
        
        toggleStrikeLoading(rowId, true);
        
        Meteor.call('getTickerInfo', `${ticker}.${exchange}`, newTradeDate, (err, result) => {
          toggleStrikeLoading(rowId, false);
          if (err) {
            console.error('Error fetching historical price:', err);
          } else {
            console.log('Historical price data received:', result);
            if (result.lastPrice) {
              $(`#strikeInput-${rowId}`).val(result.lastPrice);
              console.log(`Updated strike price to ${result.lastPrice} for trade date ${result.date}`);
            }
          }
        });
      }
    });
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

// Helper function to toggle loading state
function toggleStrikeLoading(rowId, isLoading) {
  const strikeInput = $(`#strikeInput-${rowId}`);
  if (isLoading) {
    strikeInput.prop('disabled', true);
    strikeInput.css('background-image', 'url("/images/spinner.gif")');
    strikeInput.css('background-repeat', 'no-repeat');
    strikeInput.css('background-position', 'right 8px center');
    strikeInput.css('background-size', '16px');
  } else {
    strikeInput.prop('disabled', false);
    strikeInput.css('background-image', '');
  }
} 
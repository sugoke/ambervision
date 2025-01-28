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
  
  // Initialize with existing data if available
  const data = Template.currentData();
  if (data) {
    const rowId = data.id;
    // Populate fields with correct data
    $(`#fullNameInput-${rowId}`).val(data.name || '');
    $(`#tickerInput-${rowId}`).val(data.eodTicker || '');
    $(`#exchangeInput-${rowId}`).val(data.exchange || '');
    $(`#countryInput-${rowId}`).val(data.country || '');
    $(`#currencyInput-${rowId}`).val(data.currency || '');
    $(`#strikeInput-${rowId}`).val(data.initialReferenceLevel || '');

    // Get last available price from Historical collection
    if (data.eodTicker) {
      Meteor.call('getLastHistoricalPrice', data.eodTicker, (err, result) => {
        if (!err && result) {
          $(`#closeText-${rowId}`).text(result.price || '');
          if (result.date) {
            $(`#closeDateText-${rowId}`).text(`(${result.date})`);
          }
        }
      });
    }
  }

  // Use Tracker.afterFlush to ensure DOM is ready
  Tracker.afterFlush(() => {
    const row = templateInstance.$('tr');
    console.log('Row found:', row.length > 0);
    
    const inputs = row.find('input.fullName-autocomplete');
    console.log('Inputs found:', inputs.length);
    
    inputs.each(function() {
      const inputElement = $(this);
      
      // Set autofocus
      inputElement.focus();

      // Initialize autocomplete
      inputElement.autocomplete({
        source(request, response) {
          Meteor.call('tickers.autocomplete', request.term, (err, result) => {
            if (err) {
              console.log('Autocomplete error:', err);
              response([]);
            } else {
              // Sort results to prioritize main exchanges
              const sortedResults = result.sort((a, b) => {
                // Define main exchanges by region
                const mainExchanges = {
                  US: ['US', 'NYSE', 'NASDAQ'],
                  EU: ['XETRA', 'PAR', 'AMS', 'LSE', 'SWX'],
                  ASIA: ['TSE', 'HKG', 'SSE']
                };

                // Check if exchanges are main ones
                const aExchange = a.Exchange;
                const bExchange = b.Exchange;
                
                // Check US exchanges first
                const aIsUS = mainExchanges.US.includes(aExchange);
                const bIsUS = mainExchanges.US.includes(bExchange);
                if (aIsUS && !bIsUS) return -1;
                if (!aIsUS && bIsUS) return 1;

                // Then check EU exchanges
                const aIsEU = mainExchanges.EU.includes(aExchange);
                const bIsEU = mainExchanges.EU.includes(bExchange);
                if (aIsEU && !bIsEU) return -1;
                if (!aIsEU && bIsEU) return 1;

                // Then check Asian exchanges
                const aIsAsia = mainExchanges.ASIA.includes(aExchange);
                const bIsAsia = mainExchanges.ASIA.includes(bExchange);
                if (aIsAsia && !bIsAsia) return -1;
                if (!aIsAsia && bIsAsia) return 1;

                return 0;
              });

              const data = sortedResults.map(item => ({
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

          // Create EOD ticker format
          const eodTicker = `${selectedData.Code}.${selectedData.Exchange}`;

          // Update fields
          $(`#fullNameInput-${rowId}`).val(selectedData.Name);
          $(`#tickerInput-${rowId}`).val(eodTicker);
          $(`#exchangeInput-${rowId}`).val(selectedData.Exchange);
          $(`#countryInput-${rowId}`).val(selectedData.Country);
          $(`#currencyInput-${rowId}`).val(selectedData.Currency);

          // Set the latest close price immediately from the autocomplete data
          if (selectedData.previousClose) {
            $(`#closeText-${rowId}`).text(selectedData.previousClose);
            if (selectedData.previousCloseDate) {
              $(`#closeDateText-${rowId}`).text(`(${selectedData.previousCloseDate})`);
            }
          }

          // Set the latest close price
          toggleStrikeLoading(rowId, true);
          
          // First get latest close
          Meteor.call('getTickerInfo', eodTicker, null, (err, result) => {
            if (!err && result) {
              $(`#closeText-${rowId}`).text(result.lastPrice || '');
              if (result.date) {
                $(`#closeDateText-${rowId}`).text(`(${result.date})`);
              }
            }
            
            // Then get historical price for strike if trade date is set
            if (tradeDate) {
              console.log(`Fetching historical price for ${eodTicker} on trade date: ${tradeDate}`);
              
              Meteor.call('getTickerInfo', eodTicker, tradeDate, (err, result) => {
                toggleStrikeLoading(rowId, false);
                if (err) {
                  console.error('Error fetching historical price:', err);
                } else {
                  console.log('Historical price data received:', result);
                  if (result.lastPrice) {
                    $(`#strikeInput-${rowId}`).val(result.lastPrice);
                    console.log(`Strike price set to ${result.lastPrice} for trade date ${result.date}`);
                  } else {
                    console.warn(`No historical price found for ${eodTicker} on ${tradeDate}`);
                  }
                }
              });
            } else {
              toggleStrikeLoading(rowId, false);
              console.warn('No trade date selected, cannot fetch historical price for strike');
            }
          });
        },
        open: function() {
          $(this).autocomplete('widget')
            .addClass('ui-autocomplete bg-dark border-secondary');
        }
      }).data('ui-autocomplete')._renderItem = function(ul, item) {
        const $li = $("<li>")
          .addClass("ui-menu-item")
          .attr("data-value", item.value);
        
        const $div = $("<div>")
          .addClass("autocomplete-item")
          .html(`
            <span class="ticker-code">${item.data.Code}.${item.data.Exchange}</span>
            <span class="company-name">${item.data.Name}</span>
            <span class="exchange-info">${item.data.Country} (${item.data.Currency})</span>
            <span class="price-info">${item.data.previousClose}</span>
          `);
        
        return $li.append($div).appendTo(ul);
      };
    });
  });

  // Add CSS for loading spinner
  const style = document.createElement('style');
  style.textContent = `
    .input-loading {
      background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJmZWF0aGVyIGZlYXRoZXItbG9hZGVyIj48bGluZSB4MT0iMTIiIHkxPSIyIiB4Mj0iMTIiIHkyPSI2Ij48L2xpbmU+PGxpbmUgeDE9IjEyIiB5MT0iMTgiIHgyPSIxMiIgeTI9IjIyIj48L2xpbmU+PGxpbmUgeDE9IjQuOTMiIHkxPSI0LjkzIiB4Mj0iNy43NiIgeTI9IjcuNzYiPjwvbGluZT48bGluZSB4MT0iMTYuMjQiIHkxPSIxNi4yNCIgeDI9IjE5LjA3IiB5Mj0iMTkuMDciPjwvbGluZT48bGluZSB4MT0iMiIgeTE9IjEyIiB4Mj0iNiIgeTI9IjEyIj48L2xpbmU+PGxpbmUgeDE9IjE4IiB5MT0iMTIiIHgyPSIyMiIgeTI9IjEyIj48L2xpbmU+PGxpbmUgeDE9IjQuOTMiIHkxPSIxOS4wNyIgeDI9IjcuNzYiIHkyPSIxNi4yNCI+PC9saW5lPjxsaW5lIHgxPSIxNi4yNCIgeTE9IjcuNzYiIHgyPSIxOS4wNyIgeTI9IjQuOTMiPjwvbGluZT48L3N2Zz4=') !important;
      background-position: right 8px center !important;
      background-repeat: no-repeat !important;
      background-size: 16px !important;
      padding-right: 32px !important;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  if (data && data.initialReferenceLevel) {
    this.$(`#strikeInput-${data.id}`).val(data.initialReferenceLevel);
  }
});

// Separate event map for clarity
const eventMap = {
  'input .fullName-autocomplete'(event, template) {
    const value = event.target.value.trim();
    const rowId = $(event.target).closest('tr').data('row-id');
    
    // Only proceed if we have at least 2 characters
    if (value.length < 2) return;

    // Clear previous values
    $(`#closeText-${rowId}`).text('');
    $(`#closeDateText-${rowId}`).text('');

    // Call server method to get last close
    Meteor.call('getLastPrice', value, (error, result) => {
      if (error) {
        console.error('Error fetching last price:', error);
        return;
      }
      
      if (result) {
        $(`#closeText-${rowId}`).text(result.price || '');
        if (result.date) {
          $(`#closeDateText-${rowId}`).text(`(${result.date})`);
        }
      }
    });
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
  },
  
  showCloseColumn() {
    return !isEditMode();
  }
});

// Helper function to toggle loading state
function toggleStrikeLoading(rowId, isLoading) {
  const strikeInput = $(`#strikeInput-${rowId}`);
  if (isLoading) {
    strikeInput.prop('disabled', true);
    strikeInput.addClass('input-loading');
  } else {
    strikeInput.prop('disabled', false);
    strikeInput.removeClass('input-loading');
  }
}

// Add this helper function at the top level
function isEditMode() {
  return Template.instance()?.view?.parentView?.parentView?.templateInstance?.()?.isEditMode?.get() || false;
} 
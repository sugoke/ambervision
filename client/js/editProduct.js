import {
  Template
} from 'meteor/templating';
import {
  ReactiveVar
} from 'meteor/reactive-var';
import '../html/editProduct.html';
import {
  Products
} from '/imports/api/products/products.js';
import moment from 'moment';

Template.observationRow.helpers({
  disabledIf(observation) {
    return observation.disabled ? 'disabled' : '';
  }
});

// On your client side
let isSubmitting = false;


Template.editProduct.helpers({
  isEditMode() {
    // Accessing the URL query parameters using Iron Router
    const mode = Router.current().params.query.mode;
    console.log("isEditMode check:", mode);
    return mode === "editProduct";
  },

  tickers() {
    const tickers = Template.instance().tickers.get();
    console.log("tickers:", tickers);
    return tickers;
  },

  productData() {
    const productData = Template.instance().productData.get();
    console.log("productData:", productData);
    return productData;
  },

  observations() {
  return Template.instance().observations.get();
},
});

Template.editProduct.onCreated(function() {
  // Initialize reactive variables
  this.productData = new ReactiveVar({});
  this.tickers = new ReactiveVar([]);
  this.isEditMode = new ReactiveVar(false);
  this.observations = new ReactiveVar([]);

  // Check if we are in edit mode based on URL query parameters
  const queryParams = Router.current().params.query;
  if (queryParams.mode === 'editProduct' && queryParams.ISINCode) {
    this.isEditMode.set(true);
    const ISINCode = queryParams.ISINCode;

    // Subscribe to the publication and fetch product data only in edit mode
    this.autorun(() => {
      const handle = this.subscribe('productByISIN', ISINCode);
      if (handle.ready()) {
        const product = Products.findOne({"genericInformation.ISINCode": ISINCode});
        if (product) {
          console.log('Product fetched successfully:', product);
          this.productData.set(product); // Set product data
          this.tickers.set(product.underlyings || []); // Set underlyings data
          // Optionally, log the underlyings data for verification
          console.log("Underlyings set:", product.underlyings);

          // Dynamically update form fields with product data
          $('#isin_code').val(product.genericInformation.ISINCode);
          $('#currency').val(product.genericInformation.currency);
          $('#issuer').val(product.genericInformation.issuer);
          $('#product_type').val(product.genericInformation.productType);
          $('#reoffer_price').val(product.genericInformation.reofferPrice);
          $('#issue_price').val(product.genericInformation.issuePrice);
          $('#settlement_type').val(product.genericInformation.settlementType);
          $('#settlement_tx').val(product.genericInformation.settlementTx);
          $('#tradeDate').val(product.genericInformation.tradeDate);
          $('#paymentDate').val(product.genericInformation.paymentDate);
          $('#finalObservation').val(product.genericInformation.finalObservation);
          $('#maturityDate').val(product.genericInformation.maturity);

this.observations.set(product.observations || []);


        } else {
          console.log("No product found with the given ISINCode.");
        }
      } else {
        console.log('Waiting for subscription to be ready...');
      }




    });
  } else {
    // If not in edit mode, clear or reset variables if necessary
    this.isEditMode.set(false);
    this.productData.set({});
    this.tickers.set([]);
  }
});






Template.editProduct.events({
  'click #add_ticker': function(event, instance) {
    event.preventDefault();
    const tickers = instance.tickers.get();
    const nextId = tickers.length + 1; // Determine the next ID based on array length

    tickers.push({
      id: nextId,
      ticker: '',
      fullName: '',
      close: '',
      strike: ''
    });
    instance.tickers.set(tickers); // Update the reactive variable
  },
  'click .remove_ticker'(event) {
    event.preventDefault();

    // Remove the closest 'tr' parent of the clicked button
    $(event.currentTarget).closest('tr').remove();
  },

  'click #submitProduct'(event, instance) {
    event.preventDefault();

    // Extracting mode and ISIN code from URL parameters
    const queryParams = new URLSearchParams(window.location.search);
    const mode = queryParams.get('mode');
    const isinCodeQueryParam = queryParams.get('ISINCode');
    const isEditMode = mode === 'editProduct';

    // Generic Information
    const genericInformation = {
        ISINCode: $('#isin_code').val().toUpperCase(),
        currency: $('#currency').val(),
        issuer: $('#issuer').val(),
        productType: $('#product_type').val(),
        tradeDate: $('#tradeDate').val(),
        paymentDate: $('#paymentDate').val(),
        finalObservation: $('#finalObservation').val(),
        issuePrice: $('#issue_price').val(),
        reofferPrice: $('#reoffer_price').val(),
        maturity: $('#maturityDate').val(),
        settlementType: $('#settlement_type').val(),
        settlementTx: $('#settlement_tx').val(),
    };

    // Collecting Underlyings
    let underlyings = [];
    $("#underlyingRowsContainer tr").each(function() {
        const ticker = $(this).find('input[id^="tickerInput"]').val();
        const fullName = $(this).find('input[id^="fullNameInput"]').val();
        const strike = $(this).find('input[id^="strikeInput"]').val();
        const country = $(this).find('select[id^="countrySelect"]').val();

        if (ticker) {
            underlyings.push({
                ticker,
                fullName,
                strike: parseFloat(strike || 0),
                country
            });
        }
    });

    // Collecting Observations
    let observations = [];
    $('#scheduleTable tbody tr').each(function(index) {
        const observationDate = $(this).find('.observation-date').val();
        const paymentDate = $(this).find('.payment-date').val();
        observations.push({
            n: index + 1,
            observationDate,
            paymentDate,
        });
    });

    // Preparing the product data
    const productData = {
        genericInformation,
        underlyings,
        observations,
        isEditMode,
        isinCodeQueryParam
    };

    // Decide which Meteor method to call based on the mode
    Meteor.call('products.upsert', productData, (error, result) => {
        if (error) {
            console.error('Error inserting/updating product:', error);
            alert(`Error: ${error.reason}`);
        } else {
            console.log('Product inserted/updated successfully. Result:', result);
            // Optionally, redirect the user or clear the form here
        }
    });
}

,

  'click a[href="#summary"]'(event, instance) {
    // Copy values to Summary
    $('#summaryIsinCode').text($('#isin_code').val().toUpperCase()); // Capitalize ISIN Code
    $('#summaryCurrency').text($('#currency').val());
    $('#summaryIssuer').text($('#issuer').val());
    $('#summaryProductType').text($('#product_type').val());
    $('#summaryReofferPrice').text($('#reoffer_price').val());
    $('#summaryIssuePrice').text($('#issue_price').val());
    $('#summarySettlementType').text($('#settlement_type').val());
    $('#summarySettlementTx').text($('#settlement_tx').val());
    $('#summaryTradeDate').text($('#tradeDate').val());
    $('#summaryPaymentDate').text($('#paymentDate').val());
    $('#summaryFinalObservation').text($('#finalObservation').val());
    $('#summaryMaturity').text($('#maturityDate').val());
    // Ensure to convert dates and other special formats as needed
  },
  // Event handler for the add rule button
  'click #addRuleButton'(event, instance) {
    // Determine the trigger text based on the selected observation frequency
    let triggerText = '';
    const observationFrequency = instance.$('#observation_frequency').val();
    switch (observationFrequency) {
      case 'daily':
        triggerText = 'At each daily observation date';
        break;
      case 'daily_continuous':
        triggerText = 'At any time during the life of the product';
        break;
      case 'weekly':
        triggerText = 'At each weekly observation date';
        break;
      case 'monthly':
        triggerText = 'At each monthly observation date';
        break;
      case 'quarterly':
        triggerText = 'At each quarterly observation date';
        break;
      case 'semi-annually':
        triggerText = 'At each semi-annual observation date';
        break;
      case 'annual':
        triggerText = 'At each annual observation date';
        break;
      case 'at_maturity':
        triggerText = 'No event during life';
        break;
      default:
        triggerText = '';
    }

    // Create dropdown options for the condition and barrier type
    const conditionOptions = `<option value="worst_performing">If the worst performing stock is</option>
                                <option value="basket_average">If the basket average is</option>
                                <option value="best_performing">If the best performing stock is</option>`;
    const conditionSelect = `<select class="form-select condition-select">${conditionOptions}</select>`;

    const comparisonOptions = `<option value="at_or_above">At or above</option>
                                 <option value="below">Below</option>`;
    const comparisonSelect = `<select class="form-select comparison-select">${comparisonOptions}</select>`;

    const barrierOptions = `<option value="coupon_barrier">Coupon barrier</option>
                              <option value="autocall_level">Autocall level</option>`;
    const barrierSelect = `<select class="form-select barrier-select">${barrierOptions}</select>`;

    // Create a new row with input fields and append it to the table body
    const newRow = `
        <tr class="rule-row">
          <td>${triggerText}</td>
          <td>${conditionSelect}</td>
          <td>${comparisonSelect}</td>
          <td>${barrierSelect}</td>
          <td>
            <button class="btn btn-primary add-action-button">Add Action</button>
            <button class="btn btn-danger delete-row-button">Delete</button>
          </td>
        </tr>
        <tr class="subline" style="display:none;">
          <td colspan="5">
            If True:
            <button class="btn btn-success add-consequence-button">Add Consequence</button>
          </td>
        </tr>
        <tr class="subline" style="display:none;">
          <td colspan="5">
            If False:
            <button class="btn btn-success add-consequence-button">Add Consequence</button>
          </td>
        </tr>
      `;
    instance.$('#rulesTable tbody').append(newRow);
  },

  // Event handler for adding actions based on the condition
  'click .add-action-button'(event, instance) {
    // Get the current row and find its next sibling to show the sublines
    const currentRow = $(event.target).closest('tr');
    currentRow.nextAll('.subline').show();
  },

  // Event handler for adding consequences
  'click .add-consequence-button'(event, instance) {
    // Get the current subline and append a new consequence row
    const currentSubline = $(event.target).closest('.subline');
    const newConsequenceRow = `
        <tr class="consequence-row">
          <td colspan="5">
            <select class="form-select consequence-select">
              <option value="coupon_paid">Coupon is paid</option>
              <option value="no_coupon_paid">No coupon is paid</option>
              <option value="coupon_memory">Coupon is put in memory</option>
              <option value="autocalled">Product is autocalled</option>
              <option value="nothing">Nothing</option>
              <option value="continue">The product continues</option>
            </select>
            <button class="btn btn-danger delete-row-button">Delete</button>
          </td>
        </tr>
      `;
    currentSubline.after(newConsequenceRow);
  },

  // Event handler for deleting rows
  'click .delete-row-button'(event, instance) {
    // Get the current row and its subsequent sibling rows with class .subline
    const currentRow = $(event.target).closest('tr');
    const sublines = currentRow.nextUntil(':not(.subline)');

    // Remove all these rows
    currentRow.add(sublines).remove();
  },

  'click #generateSchedule'(event, instance) {
    event.preventDefault();


    // Helper functions
    function toISODateString(date) {
      return date.toISOString().split('T')[0];
    }

    function addMonths(date, months) {
      const newDate = new Date(date);
      newDate.setMonth(newDate.getMonth() + months);
      return newDate;
    }

    function addDays(date, days) {
      const newDate = new Date(date);
      newDate.setDate(newDate.getDate() + days);
      return newDate;
    }

    // Extracting input values
    const tradeDate = new Date(instance.$('#tradeDate').val());
    const finalObservationDate = new Date(instance.$('#finalObservation').val());
    const settlementTx = parseInt(instance.$('#settlement_tx').val(), 10);
    const observationFrequency = instance.$('#observation_frequency').val();

    // Validation
    if (isNaN(settlementTx)) {
      console.error('Settlement T+x is not a valid number');
      return;
    }

    const observations = [];

    // Always include the "Initial" observation as disabled
    observations.push({
      n: 'Initial',
      observationDate: toISODateString(tradeDate),
      paymentDate: toISODateString(tradeDate),
      disabledAttribute: 'disabled' // This ensures the input fields are disabled
    });

    // Handling for specific frequencies
    if (['weekly', 'monthly', 'quarterly', 'semi-annually', 'annual'].includes(observationFrequency)) {
      let currentDate = addDays(tradeDate, 1); // Start from the day after the trade date

      while (currentDate < finalObservationDate) {
        observations.push({
          n: observations.length, // Use the current length of observations as the label
          observationDate: toISODateString(currentDate),
          paymentDate: toISODateString(addDays(currentDate, settlementTx)),
          disabledAttribute: ''
        });

        // Increment the date based on the selected frequency
        switch (observationFrequency) {
          case 'weekly':
            currentDate = addDays(currentDate, 7);
            break;
          case 'monthly':
            currentDate = addMonths(currentDate, 1);
            break;
          case 'quarterly':
            currentDate = addMonths(currentDate, 3);
            break;
          case 'semi-annually':
            currentDate = addMonths(currentDate, 6);
            break;
          case 'annual':
            currentDate = addMonths(currentDate, 12);
            break;
        }
      }
    }

    observations.push({
      n: 'Final',
      observationDate: toISODateString(finalObservationDate),
      paymentDate: toISODateString(finalObservationDate),
      disabledAttribute: 'disabled' // This ensures the input fields are disabled
    });

    // Update the reactive variable with observations
    instance.observations.set(observations);
  },

  'show.bs.tab a[data-bs-toggle="tab"]'(event, instance) {
    if (event.target.hash === '#dates') { // Check if the Dates tab is being shown
      // Copy the values from the Main tab to the Dates tab fields
      const tradeDate = instance.$('#tradeDate').val(); // Assuming this is the ID on the Main tab
      const paymentDate = instance.$('#paymentDate').val(); // Assuming this is the ID on the Main tab
      const finalObservationDate = instance.$('#finalObservation').val(); // Assuming this is the ID on the Main tab
      const maturityDate = instance.$('#maturityDate').val(); // Assuming this is the ID on the Main tab

      // Now set the values in the Dates tab
      instance.$('#observationDate0').val(tradeDate);
      instance.$('#paymentDate0').val(paymentDate);
      instance.$('#observationDate1').val(finalObservationDate);
      instance.$('#paymentDate1').val(maturityDate);
    }
  },


  'shown.bs.tab a[href="#dates"]'(event, instance) {
      // Fetch values from the main pane
      const tradeDate = instance.$('#tradeDate').val();
      const paymentDate = instance.$('#paymentDate').val();
      const finalObservation = instance.$('#finalObservation').val();
      const maturityDate = instance.$('#maturityDate').val();

      // Retrieve or initialize the observations array
      let observations = instance.observations.get() || [];

      // Ensure the "Initial" and "Final" entries exist
      if (observations.length < 2) {
        observations = [
          { observationDate: tradeDate, paymentDate: paymentDate, disabled: true },
          { observationDate: finalObservation, paymentDate: maturityDate, disabled: true }
        ];
      } else {
        // Update "Initial"
        observations[0].observationDate = tradeDate;
        observations[0].paymentDate = paymentDate;
        observations[0].disabled = true;  // Ensure the input field is disabled

        // Update "Final"
        observations[observations.length - 1].observationDate = finalObservation;
        observations[observations.length - 1].paymentDate = maturityDate;
        observations[observations.length - 1].disabled = true;  // Ensure the input field is disabled
      }

      // Re-set the reactive variable to update the UI
      instance.observations.set(observations);

      // Optionally, update the UI directly if the observations are directly rendered in HTML
      // This is a fallback method and ideally should be managed through reactive data binding
      instance.$('#datesTable .observation-date:first').prop('disabled', true);
      instance.$('#datesTable .observation-date:last').prop('disabled', true);
      instance.$('#datesTable .payment-date:first').prop('disabled', true);
      instance.$('#datesTable .payment-date:last').prop('disabled', true);
    }

});

Template.underlyingRow.onRendered(function() {
  const templateInstance = this;

  templateInstance.autorun(() => {
    templateInstance.$('.fullName-autocomplete').autocomplete({
      source: function(request, response) {
        console.log("Autocomplete search started for:", request.term);
        Meteor.call('searchTickersByName', request.term, (error, tickers) => {
          if (error) {
            console.error("Error searching tickers by name:", error);
          } else {
            console.log("Tickers found for autocomplete:", tickers);
            const formattedTickers = tickers.map((ticker) => ({
              label: `${ticker.Name} (${ticker.Code}) - ${ticker.Country}`,
              value: ticker.Name,
              tickerCode: ticker.Code,
              country: ticker.Country,
              exchange: ticker.Exchange,
              currency: ticker.Currency
            }));
            response(formattedTickers);
          }
        });
      },
      select: function(event, ui) {
        event.preventDefault();
        const $row = $(this).closest('tr');

        console.log("Autocomplete item selected:", ui.item);

        $row.find('.fullName-autocomplete').val(ui.item.value);
        $row.find('[id^="tickerInput-"]').val(ui.item.tickerCode);
        $row.find('[id^="countryInput-"]').val(ui.item.country);

        const symbolWithExchange = `${ui.item.tickerCode}.${ui.item.exchange}`;
        console.log("Fetching closing price for:", symbolWithExchange);

        Meteor.call('getTickerClosingPrice', symbolWithExchange, (error, result) => {
          if (!error && result) {
            console.log('Fetched closing price data:', result);
            const { close: lastAvailablePrice, date: priceDate } = result[0] || {};
            console.log('Extracted closing price:', lastAvailablePrice, 'on date:', priceDate);
            if (lastAvailablePrice && priceDate) {
              $row.find(`[id^="closeText-"]`).text(`${ui.item.currency} ${lastAvailablePrice} (${priceDate})`);
            } else {
              console.log('No closing price data received.');
            }
          } else {
            console.log("Error fetching closing price:", error);
          }
        });


        return false;
      },
      minLength: 2,
    });
  });
});




// Assuming you have a helper function to parse dates and add days
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

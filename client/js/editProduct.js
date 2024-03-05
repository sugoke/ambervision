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

Template.editProduct.helpers({
  isEditMode() {
    // This assumes you're using Iron Router or a similar router for handling URLs
    const mode = Router.current().params.query.mode;
    return mode === "editProduct";
  },

  tickers() {
    return Template.instance().tickers.get();
  }
});


Template.editProduct.onCreated(function() {
  this.tickers = new ReactiveVar([]);
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
      // Include other fields as necessary
    };

    let underlyings = [];

  $("#underlyingRowsContainer tr").each(function(index) {
    const rowId = $(this).attr("id").split("-")[1]; // Extract the ticker ID from the row ID

    const ticker = $(`#tickerInput-${rowId}`).val();
    const fullName = $(`#fullNameInput-${rowId}`).val();
    const strike = $(`#strikeInput-${rowId}`).val();
    const country = $(`#countrySelect-${rowId}`).val();

    if (ticker && fullName && strike) {
      underlyings.push({ ticker, country, fullName, strike: parseFloat(strike) });
    } else {
      console.log(`Missing required field in row ${index}. Ticker: ${ticker}, FullName: ${fullName}, Strike: ${strike}`);
    }
  });

  console.log("Collected underlyings:", underlyings);


    // Observations logic remains the same as provided

    let observations = [];
    $('#scheduleTable tbody tr').each(function(index) {
      const observationDate = $(this).find('input[type="date"]:first').val();
      const paymentDate = $(this).find('input[type="date"]:last').val();

      if (observationDate && paymentDate) {
        observations.push({
          n: index + 1,
          observationDate,
          paymentDate,
        });
      }
    });

    // Prepare the full product data
    const productData = {
      genericInformation,
      underlyings,
      observations,
      // Include additional sections as necessary
    };

    // Call the Meteor method to insert the product data
    Meteor.call('products.insert', productData, (error, result) => {
      if (error) {
        console.error('Error inserting product:', error);
        alert(error.reason);
      } else {
        console.log('Product inserted successfully:', result);
        // Optionally, redirect the user or clear the form here
      }
    });
  },

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

    const tradeDate = new Date(instance.$('#tradeDate').val()); // Assuming this is the ID on the Main tab
    const finalObservationDate = new Date(instance.$('#finalObservation').val()); // Assuming this is the ID on the Main tab
    const settlementTx = parseInt(instance.$('#settlement_tx').val(), 10); // The number of days for settlement

    if (isNaN(settlementTx)) {
      console.error('Settlement T+x is not a valid number');
      return;
    }

    const observationFrequency = instance.$('#observation_frequency').val();
    let currentDate = new Date(tradeDate);
    const schedule = [];

    // Clear existing table rows
    const scheduleTableBody = instance.$('#scheduleTable tbody');
    scheduleTableBody.empty();

    if (observationFrequency === 'daily' || observationFrequency === 'at_maturity') {
      // Display message for daily observation or observation at maturity
      const initialRow = `<tr><td>Initial</td><td><input type="date" class="form-control" value="${tradeDate.toISOString().substring(0, 10)}" disabled></td><td><input type="date" class="form-control" value="${addDays(tradeDate, settlementTx).toISOString().substring(0, 10)}" disabled></td></tr>`;
      const finalRow = `<tr><td>Final</td><td><input type="date" class="form-control" value="${finalObservationDate.toISOString().substring(0, 10)}" disabled></td><td><input type="date" class="form-control" value="${finalObservationDate.toISOString().substring(0, 10)}" disabled></td></tr>`;
      scheduleTableBody.append(initialRow);
      scheduleTableBody.append(finalRow);

      // Add comment below the dates based on the selected frequency
      let comment = '';
      if (observationFrequency === 'daily') {
        comment = 'Daily observations from trade date to final date';
      } else {
        comment = 'Observation only at maturity';
      }
      const commentRow = `<tr><td colspan="3">${comment}</td></tr>`;
      scheduleTableBody.append(commentRow);

      return; // No need to proceed further
    }

    let index = 0;
    while (currentDate <= finalObservationDate) {
      const observationDate = currentDate.toISOString().substring(0, 10);
      const paymentDate = addDays(currentDate, settlementTx).toISOString().substring(0, 10);

      // Determine the label based on the observation frequency
      let label = '';
      switch (observationFrequency) {
        case 'weekly':
          label = `W${index}`;
          break;
        case 'monthly':
          label = `M${index}`;
          break;
        case 'quarterly':
          label = `Q${index}`;
          break;
        case 'semi-annually':
          label = `S${index}`;
          break;
        case 'annual':
          label = `Y${index}`;
          break;
          // Handle other cases as necessary
      }

      // Check if it's the first or last row
      if (index === 0) {
        label = 'Initial';
      } else if (currentDate >= finalObservationDate) {
        label = 'Final';
      }

      // Create a new table row with input fields
      const newRow = `
        <tr>
          <td>${label}</td>
          <td><input type="date" class="form-control" value="${observationDate}" ${index === 0 || currentDate >= finalObservationDate ? 'disabled' : ''}></td>
          <td><input type="date" class="form-control" value="${paymentDate}" ${index === 0 || currentDate >= finalObservationDate ? 'disabled' : ''}></td>
        </tr>
      `;

      // Append the new row to the table body
      scheduleTableBody.append(newRow);

      // Increment currentDate by the selected frequency
      switch (observationFrequency) {
        case 'weekly':
          currentDate = addDays(currentDate, 7);
          break;
        case 'monthly':
          currentDate.setMonth(currentDate.getMonth() + 1);
          break;
        case 'quarterly':
          currentDate.setMonth(currentDate.getMonth() + 3);
          break;
        case 'semi-annually':
          currentDate.setMonth(currentDate.getMonth() + 6);
          break;
        case 'annual':
          currentDate.setFullYear(currentDate.getFullYear() + 1);
          break;
          // Handle other cases as necessary
      }
      index++;
    }
  }


  ,

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




});

// Assuming you have a helper function to parse dates and add days
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

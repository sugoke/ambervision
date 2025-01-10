import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { Products } from '/imports/api/products/products.js';
import { Random } from 'meteor/random';
import { Router } from 'meteor/iron:router';

/**
 * @returns {String} - Formatted product name.
 */
Template.orionTemplate.constructProductName = function() {
  var underlyings = [];
  $('#underlyingRowsContainer tr').each(function () {
    var name = $(this).find('input[id^="fullNameInput-"]').val() || '';
    if (name.trim() !== '') {
      underlyings.push(name);
    }
  });

  if (underlyings.length === 0) return 'Orion';

  var name = 'Orion on ';
  if (underlyings.length === 1) {
    name += underlyings[0];
  } else if (underlyings.length === 2) {
    name += `${underlyings[0]} / ${underlyings[1]}`;
  } else {
    name += `${underlyings[0]} / ${underlyings[1]} /...`;
  }
  return name;
};

Template.orionTemplate.onCreated(function() {
  this.currentProduct = new ReactiveVar(null);
  this.currentProductId = new ReactiveVar(null);
  this.tickers = new ReactiveVar([]);
});

Template.orionTemplate.onRendered(function() {
  var instance = this;
  
  this.autorun(function() {
    var product = instance.currentProduct.get();
    if (product && product.features) {
      $('#upperBarrier').val(product.features.upperBarrier);
      $('#rebate').val(product.features.rebate);
    }
  });

  // Initialize summary
  updateOrionSummary();

  // Update summary when switching to summary tab
  $('a[data-bs-toggle="tab"]').on('shown.bs.tab', function (e) {
    if ($(e.target).attr('href') === '#summary') {
      updateOrionSummary();
    }
  });
});

Template.orionTemplate.helpers({
  product() {
    return Template.instance().currentProduct.get();
  }
});

Template.orionTemplate.events({
  'input input, change select'(event, template) {
    updateOrionSummary();
  },

  'click #add_ticker'(event, template) {
    event.preventDefault();
    
    const underlyingsContainer = $('#underlyingRowsContainer');
    const lastRow = underlyingsContainer.children().last();
    
    if (lastRow.length) {
      const emptyFields = lastRow.find('input').filter(function() {
        return !this.value.trim();
      });
      
      if (emptyFields.length > 0) {
        alert('Please fill all fields in the current row before adding a new one');
        emptyFields.addClass('is-invalid');
        return;
      }
    }

    const currentCount = underlyingsContainer.children().length;
    const newId = currentCount + 1;

    const templateData = {
      id: newId,
      fullName: '',
      ticker: '',
      exchange: '',
      country: '',
      currency: '',
      strike: ''
    };

    if (Template.underlyingRow) {
      Blaze.renderWithData(Template.underlyingRow, templateData, underlyingsContainer[0]);
      updateOrionSummary();
    } else {
      console.error('underlyingRow template not found');
    }
  },

  'click .remove_ticker'(event) {
    event.preventDefault();
    const rowId = $(event.currentTarget).data('id');
    $(`#tickerRow-${rowId}`).remove();
    updateOrionSummary();
  },

  'input .underlyingRowsContainer input'(event) {
    $(event.target).removeClass('is-invalid');
  },

  'click #submitOrionProduct'(event, template) {
    event.preventDefault();
    
    try {
      const productData = gatherOrionData();
      const isin = $('#isin_code').val();
      
      if (!isin) {
        alert('ISIN code is required');
        return;
      }

      // Get the existing product ID if in edit mode
      const queryParams = Router.current().params.query;
      const isEditMode = queryParams.mode === 'editProduct';
      
      if (isEditMode) {
        // Update existing product
        Meteor.call('updateProduct', productData._id, productData, (error, result) => {
          if (error) {
            console.error('Error updating product:', error);
            alert('Error updating product: ' + error.reason);
          } else {
            alert('Product updated successfully');
            Router.go('products');
          }
        });
      } else {
        // Insert new product
        Meteor.call('insertProduct', productData, (error, result) => {
          if (error) {
            console.error('Error inserting product:', error);
            alert('Error inserting product: ' + error.reason);
          } else {
            alert('Product inserted successfully');
            Router.go('products');
          }
        });
      }
    } catch (error) {
      console.error('Error gathering product data:', error);
      alert('Error gathering product data: ' + error.message);
    }
  }
});

// First, define the updateOrionSummary function at the top level
function updateOrionSummary() {
  // General Information
  $('#summaryIsinCode').text($('#isin_code').val());
  $('#summaryValoren').text($('#valoren').val());
  $('#summaryCurrency').text($('#currency').val());
  $('#summaryIssuer').text($('#issuer').val());
  $('#summaryProductType').text('Orion');
  $('#summarySettlementType').text($('#settlement_type').val());
  $('#summarySettlementTx').text($('#settlement_tx').val());

  // Key Dates
  $('#summaryTradeDate').text($('#tradeDate').val());
  $('#summaryPaymentDate').text($('#paymentDate').val());
  $('#summaryFinalObservation').text($('#finalObservation').val());
  $('#summaryMaturity').text($('#maturityDate').val());

  // Product Mechanism
  $('#summaryUpperBarrier').text($('#upperBarrier').val() ? $('#upperBarrier').val() + '%' : '');
  $('#summaryRebate').text($('#rebate').val() ? $('#rebate').val() + '%' : '');

  // Update underlyings in the summary
  const summaryUnderlyingsTable = $('#summaryUnderlyings tbody');
  summaryUnderlyingsTable.empty();

  $('#underlyingRowsContainer tr').each(function() {
    const name = $(this).find('[id^=fullNameInput-]').val() || '';
    const ticker = $(this).find('[id^=tickerInput-]').val() || '';
    const exchange = $(this).find('[id^=exchangeInput-]').val() || '';
    const strike = $(this).find('[id^=strikeInput-]').val() || '';
    const eodTicker = ticker && exchange ? `${ticker}.${exchange}` : '';

    summaryUnderlyingsTable.append(`
      <tr>
        <td>${name}</td>
        <td>${ticker}</td>
        <td>${strike}</td>
        <td>${eodTicker}</td>
      </tr>
    `);
  });
}

// Add this function to gather all Orion product data
function gatherOrionData() {
  const productData = {
    status: "pending",
    genericData: {},
    features: {},
    underlyings: [],
  };

  // Add product ID if in edit mode
  const queryParams = Router.current().params.query;
  if (queryParams.mode === 'editProduct' && queryParams.isin) {
    const existingProduct = Products.findOne({
      $or: [
        { "genericData.ISINCode": queryParams.isin },
        { "ISINCode": queryParams.isin }
      ]
    });
    if (existingProduct) {
      productData._id = existingProduct._id;
    }
  }

  // Gather generic data
  productData.genericData = {
    ISINCode: $('#isin_code').val(),
    currency: $('#currency').val(),
    issuer: $('#issuer').val(),
    settlementType: $('#settlement_type').val(),
    settlementTx: $('#settlement_tx').val(),
    tradeDate: $('#tradeDate').val(),
    paymentDate: $('#paymentDate').val(),
    finalObservation: $('#finalObservation').val(),
    maturityDate: $('#maturityDate').val(),
    template: 'orion',
    valoren: $('#valoren').val()
  };

  // Generate product name
  const underlyings = [];
  $('#underlyingRowsContainer tr').each(function() {
    const ticker = $(this).find('[id^=tickerInput-]').val();
    underlyings.push(ticker);
  });
  productData.genericData.name = `Orion on ${underlyings.join('/')}`;

  // Gather features specific to Orion
  productData.features = {
    upperBarrier: parseFloat($('#upperBarrier').val()),
    rebate: parseFloat($('#rebate').val())
  };

  // Gather underlyings
  $('#underlyingRowsContainer tr').each(function() {
    const ticker = $(this).find('[id^=tickerInput-]').val();
    const exchange = $(this).find('[id^=exchangeInput-]').val();
    const underlying = {
      name: $(this).find('[id^=fullNameInput-]').val(),
      ticker: ticker,
      exchange: exchange,
      country: $(this).find('[id^=countryInput-]').val(),
      currency: $(this).find('[id^=currencyInput-]').val(),
      initialReferenceLevel: parseFloat($(this).find('[id^=strikeInput-]').val()),
      eodTicker: `${ticker}.${exchange}`
    };
    productData.underlyings.push(underlying);
  });

  console.log('Gathered Orion product data:', productData);
  return productData;
}

import { Router } from 'meteor/iron:router';
import { Template } from 'meteor/templating';
import moment from 'moment';
import '/client/html/templates/underlyingRow.html';
import { Issuers } from '/imports/api/issuers/issuers.js';

// Make sure updateSummary is also defined at the top level
export function updateSummary() {
    // General Information
    $('#summaryIsinCode').text($('#isin_code').val());
    $('#summaryValoren').text($('#valoren').val());
    $('#summaryCurrency').text($('#currency').val());
    $('#summaryIssuer').text($('#issuer').val());
    $('#summaryProductType').text($('#product_type').val());
    $('#summarySettlementType').text($('#settlement_type').val());
    $('#summarySettlementTx').text($('#settlement_tx').val());
    $('#summaryCouponPerPeriod').text($('#coupon_per_period').val());
  
    // Key Dates
    $('#summaryTradeDate').text($('#tradeDate').val());
    $('#summaryPaymentDate').text($('#paymentDate').val());
    $('#summaryFinalObservation').text($('#finalObservation').val());
    $('#summaryMaturity').text($('#maturityDate').val());
  
    // Product Mechanism
    $('#summaryMemoryCoupon').text($('#memoryCoupon').is(':checked') ? 'Yes' : 'No');
    $('#summaryMemoryLocks').text($('#memoryAutocall').is(':checked') ? 'Yes' : 'No');
    $('#summaryOneStar').text($('#oneStar').is(':checked') ? 'Yes' : 'No');
    $('#summaryLowStrike').text($('#lowStrike').is(':checked') ? 'Yes' : 'No');
    $('#summaryAutocallStepdown').text($('#step_down').is(':checked') ? 'Yes' : 'No');
    $('#summaryCapitalProtectionBarrier').text($('#phoenix_capital_protection_barrier').val() ? $('#phoenix_capital_protection_barrier').val() + '%' : '');
    $('#summaryStepDown').text($('#step_down').is(':checked') ? $('#step_down_step').val() + '%' : 'No');
    $('#summaryJump').text($('#jump').is(':checked') ? 'Yes' : 'No');
  
    // Update underlyings in the summary
    const summaryUnderlyingsTable = document.getElementById('summaryUnderlyings');
    if (summaryUnderlyingsTable) {
      const tbody = summaryUnderlyingsTable.getElementsByTagName('tbody')[0];
      if (tbody) {
        tbody.innerHTML = ''; // Clear existing rows

        $('#underlyingRowsContainer tr').each(function(index) {
          const fullName = $(this).find('[id^=fullNameInput-]').val() || '';
          const ticker = $(this).find('[id^=tickerInput-]').val() || '';
          const strike = $(this).find('[id^=strikeInput-]').val() || '';

          const row = tbody.insertRow();
          row.innerHTML = `
            <td>${fullName}</td>
            <td>${ticker}</td>
            <td>${strike}</td>
            <td>${ticker}</td>
          `;
        });
      }
    }
  
    // Update the schedule in the summary
    updateSummarySchedule();
}

export function updateSummarySchedule() {
    const summaryScheduleTable = document.getElementById('summarySchedule');
    if (summaryScheduleTable) {
      const tbody = summaryScheduleTable.getElementsByTagName('tbody')[0];
      if (tbody) {
        tbody.innerHTML = ''; // Clear existing rows

        $('#scheduleTable tbody tr').each(function(index) {
          const observationDate = $(this).find('.observation-date').val();
          const paymentDate = $(this).find('.payment-date').val();
          const couponBarrier = $(this).find('.coupon-barrier').val();
          const autocallBarrier = $(this).find('.autocall-barrier').val();
          const couponPerPeriod = $(this).find('.coupon-per-period').val();

          const row = tbody.insertRow();
          row.innerHTML = `
            <td>${index + 1}</td>
            <td>${observationDate}</td>
            <td>${paymentDate}</td>
            <td>${couponBarrier}%</td>
            <td>${autocallBarrier}%</td>
            <td>${couponPerPeriod}%</td>
          `;
        });
      }
    }
}

// Function declarations without inline exports
export function gatherPhoenixData() {
  const productData = {
    status: "pending",
    genericData: {},
    features: {},
    underlyings: [],
    observationDates: [],
    observationsTable: []
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

  // Transform ISIN to uppercase
  productData.genericData.ISINCode = $('#isin_code').val().toUpperCase();
  productData.genericData.currency = $('#currency').val();
  productData.genericData.issuer = $('#issuer').val();
  productData.genericData.settlementType = $('#settlement_type').val();
  productData.genericData.settlementTx = $('#settlement_tx').val();
  productData.genericData.tradeDate = $('#tradeDate').val();
  productData.genericData.paymentDate = $('#paymentDate').val();
  productData.genericData.finalObservation = $('#finalObservation').val();
  productData.genericData.maturityDate = $('#maturityDate').val();
  productData.genericData.template = $('#product_type').val();

  // Generate product name
  const underlyings = getPhoenixUnderlyings();
  const underlyingNames = underlyings.map(u => u.ticker).join('/');
  const couponPerPeriod = parseFloat($('#phoenix_coupon_per_period').val());
  const maturityDate = $('#maturityDate').val();
  const maturityYear = maturityDate ? new Date(maturityDate).getFullYear() : '';
  
  productData.genericData.name = `Phoenix on ${underlyingNames} ${couponPerPeriod}% ${maturityYear}`;

  // Gather features specific to Phoenix
  productData.features.memoryCoupon = $('#memoryCoupon').is(':checked');
  productData.features.memoryAutocall = $('#memoryAutocall').is(':checked');
  productData.features.oneStar = $('#oneStar').is(':checked');
  productData.features.lowStrike = $('#lowStrike').is(':checked');
  productData.features.autocallStepdown = $('#autocallStepdown').is(':checked');
  productData.features.jump = $('#jump').is(':checked');
  productData.features.stepDown = $('#step_down').is(':checked');
  productData.features.stepDownSize = $('#step_down_step').val();
  productData.features.couponBarrier = parseFloat($('#phoenix_coupon_barrier').val());
  productData.features.capitalProtectionBarrier = parseFloat($('#phoenix_capital_protection_barrier').val());
  productData.features.couponPerPeriod = parseFloat($('#phoenix_coupon_per_period').val());

  // Gather underlyings using the helper function
  productData.underlyings = getPhoenixUnderlyings();

  // Gather observation dates
  $('#scheduleTable tbody tr').each(function() {
    const $row = $(this);
    productData.observationDates.push({
      observationDate: $row.find('.observation-date').val(),
      paymentDate: $row.find('.payment-date').val(),
      couponBarrierLevel: parseFloat($row.find('.coupon-barrier').val()) || null,
      autocallLevel: parseFloat($row.find('.autocall-barrier').val()) || null,
      couponPerPeriod: parseFloat($row.find('.coupon-per-period').val()) || null
    });
  });

  console.log('Gathered Phoenix product data:', productData);
  return productData;
}

// Helper function to get underlyings specific to Phoenix
export function getPhoenixUnderlyings() {
  const underlyings = [];
  $('#underlyingRowsContainer tr').each(function() {
    const ticker = $(this).find('[id^=tickerInput]').val();
    const exchange = $(this).find('[id^=exchangeInput]').val();
    
    const underlying = {
      name: $(this).find('.fullName-autocomplete').val(),
      ticker: ticker, // Store the full ticker (e.g., "ADS.XETRA")
      exchange: exchange,
      country: $(this).find('[id^=countryInput]').val(),
      currency: $(this).find('[id^=currencyInput]').val(),
      initialReferenceLevel: parseFloat($(this).find('[id^=strikeInput]').val()),
      eodTicker: ticker, // Store the full ticker here too
      lastPriceInfo: {
        price: parseFloat($(this).find('[id^=closeText]').text()) || null,
        performance: null,
        distanceToBarrier: null,
        date: $(this).find('[id^=closeDateText]').text() || null,
        isWorstOf: false
      }
    };
    underlyings.push(underlying);
  });
  return underlyings;
}

// Function to populate underlyings for Phoenix
function populatePhoenixUnderlyings(underlyings) {
  console.log("Populating Phoenix underlyings:", underlyings);
  const underlyingsContainer = $('#underlyingRowsContainer');
  underlyingsContainer.empty();

  if (!Array.isArray(underlyings)) {
    console.error("underlyings is not an array:", underlyings);
    return;
  }

  underlyings.forEach((underlying, index) => {
    if (!underlying) {
      console.error(`Underlying at index ${index} is undefined`);
      return;
    }

    // Use the underlyingRow template
    const templateData = {
      id: index + 1,
      fullName: underlying.name || '',
      ticker: underlying.eodTicker || '',  // Use full eodTicker
      exchange: underlying.exchange || '',
      country: underlying.country || '',
      currency: underlying.currency || '',
      strike: underlying.initialReferenceLevel || '',
      close: underlying.lastPriceInfo?.price || '',
      closeDate: underlying.lastPriceInfo?.date || ''  // Add the close date
    };

    const renderedTemplate = Blaze.toHTMLWithData(Template.underlyingRow, templateData);
    underlyingsContainer.append(renderedTemplate);
  });
}

function populatePhoenixObservations(observations) {
  console.log("Populating Phoenix observations:", observations);
  const scheduleContainer = $('#scheduleTable tbody');
  scheduleContainer.empty();

  if (!Array.isArray(observations)) {
    console.error("observations is not an array:", observations);
    return;
  }

  observations.forEach((observation, index) => {
    if (!observation) {
      console.error(`Observation at index ${index} is undefined`);
      return;
    }

    // Use the observationRow template
    const templateData = {
      n: index + 1,
      observationDate: observation.observationDate || '',
      paymentDate: observation.paymentDate || '',
      couponBarrier: observation.couponBarrierLevel || '',
      autocallBarrier: observation.autocallLevel || '',
      couponPerPeriod: observation.couponPerPeriod || '',
      disabledAttribute: '' // Add any disabled logic if needed
    };

    const renderedTemplate = Blaze.toHTMLWithData(Template.observationRow, templateData);
    scheduleContainer.append(renderedTemplate);
  });
}

// Helper function to format date
function formatDate(dateString) {
  const date = new Date(dateString);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

// Export the main population functions
export function populatePhoenixFormFields(product) {
  console.log("Populating Phoenix form with data:", product);

  // Generic Data
  $('#isin_code').val(product.genericData.ISINCode);
  $('#currency').val(product.genericData.currency);
  
  // Fix issuer population - handle both ID and name cases
  const issuerValue = product.genericData.issuer;
  if (issuerValue) {
    Tracker.autorun((computation) => {
      if (Meteor.subscribe('issuers').ready()) {
        // Try to find issuer by ID first
        let issuer = Issuers.findOne(issuerValue);
        
        // If not found by ID, try to find by name
        if (!issuer) {
          issuer = Issuers.findOne({ name: issuerValue });
        }
        
        if (issuer) {
          $('#issuer').val(issuer._id);
        }
        computation.stop();
      }
    });
  }

  $('#settlement_type').val(product.genericData.settlementType);
  $('#settlement_tx').val(product.genericData.settlementTx);
  
  // Dates
  $('#tradeDate').val(moment(product.genericData.tradeDate).format('YYYY-MM-DD'));
  $('#paymentDate').val(moment(product.genericData.paymentDate).format('YYYY-MM-DD'));
  $('#finalObservation').val(moment(product.genericData.finalObservation).format('YYYY-MM-DD'));
  $('#maturityDate').val(moment(product.genericData.maturityDate).format('YYYY-MM-DD'));

  // Features/Mechanisms
  $('#memoryCoupon').prop('checked', product.features.memoryCoupon);
  $('#memoryAutocall').prop('checked', product.features.memoryAutocall);
  $('#oneStar').prop('checked', product.features.oneStar);
  $('#lowStrike').prop('checked', product.features.lowStrike);
  $('#step_down').prop('checked', product.features.stepDown);
  $('#jump').prop('checked', product.features.jump);
  
  // Phoenix-specific fields
  $('#phoenix_coupon_barrier').val(product.features.couponBarrier);
  $('#phoenix_capital_protection_barrier').val(product.features.capitalProtectionBarrier);
  $('#phoenix_coupon_per_period').val(product.features.couponPerPeriod);
  
  if (product.features.stepDown) {
    $('#phoenix_step_down').prop('checked', true);
    $('#phoenix_step_down_fields').show();
    $('#phoenix_step_size').val(product.features.stepDownSize);
  }

  // Populate underlyings
  const underlyingsContainer = $('#underlyingRowsContainer');
  underlyingsContainer.empty();
  
  if (product.underlyings && product.underlyings.length) {
    product.underlyings.forEach((underlying, index) => {
      const renderRow = (lastPrice, lastPriceDate) => {
        const templateData = {
          id: index + 1,
          fullName: underlying.name,
          ticker: underlying.eodTicker || '',  // Use full eodTicker (e.g., "ADS.XETRA")
          exchange: underlying.exchange || '',
          country: underlying.country,
          currency: underlying.currency,
          strike: underlying.initialReferenceLevel,
          close: lastPrice || underlying.lastPriceInfo?.price || '',
          closeDate: lastPriceDate || underlying.lastPriceInfo?.date || ''  // Add the close date
        };

        // Remove existing row if it exists
        $(`#tickerRow-${index + 1}`).remove();
        
        // Render new row
        Blaze.renderWithData(Template.underlyingRow, templateData, underlyingsContainer[0]);
      };

      // Initial render with existing data
      renderRow(
        underlying.lastPriceInfo?.price,
        underlying.lastPriceInfo?.date  // Pass the existing date
      );

      // Try to get updated price
      if (underlying.eodTicker) {
        Meteor.call('getLastPrice', underlying.eodTicker, (error, result) => {
          if (error) {
            console.error('Error getting last price:', error);
          } else {
            // Update with new price data and date
            renderRow(result?.lastPrice, result?.date);  // Pass both price and date from result
          }
        });
      }
    });
  }

  // Populate observation dates
  const scheduleContainer = $('#scheduleTable tbody');
  scheduleContainer.empty();
  
  if (product.observationDates && product.observationDates.length) {
    product.observationDates.forEach((observation, index) => {
      const templateData = {
        n: index + 1,
        observationDate: moment(observation.observationDate).format('YYYY-MM-DD'),
        paymentDate: moment(observation.paymentDate).format('YYYY-MM-DD'),
        couponBarrier: observation.couponBarrierLevel,
        autocallBarrier: observation.autocallLevel || '',
        couponPerPeriod: observation.couponPerPeriod
      };
      Blaze.renderWithData(Template.observationRow, templateData, scheduleContainer[0]);
    });
  }

  // Update summary after populating all fields
  updateSummary();
}

// Add this helper function at the top level
function showModal(title, message, callback) {
  const modal = new bootstrap.Modal(document.getElementById('alertModal'));
  const modalElement = document.getElementById('alertModal');
  
  modalElement.querySelector('.modal-title').textContent = title;
  modalElement.querySelector('.modal-body').textContent = message;
  
  if (callback) {
    modalElement.addEventListener('hidden.bs.modal', callback, { once: true });
  }
  
  modal.show();
}

// Add these helper functions at the top level
function isWeekend(date) {
  const day = date.day();
  return day === 0 || day === 6; // 0 is Sunday, 6 is Saturday
}

function getNextBusinessDay(date, holidays = []) {
  let nextDay = moment(date);
  
  // Convert holidays to moment objects if they're strings
  const holidayMoments = holidays.map(h => moment(h));
  
  do {
    nextDay.add(1, 'days');
  } while (
    isWeekend(nextDay) || 
    holidayMoments.some(holiday => holiday.isSame(nextDay, 'day'))
  );
  
  return nextDay;
}

// Add these validation functions at the top level
const ValidationRules = {
  isin: {
    pattern: /^[A-Z]{2}[A-Z0-9]{10}$/,
    message: 'ISIN must be 12 characters: 2 letters followed by 10 alphanumeric characters'
  },
  currency: {
    pattern: /^(USD|EUR|GBP|CHF)$/,
    message: 'Please select a valid currency'
  },
  issuer: {
    required: true,
    message: 'Please select an issuer'
  },
  settlementType: {
    pattern: /^(Cash|Physical)$/,
    message: 'Settlement type must be either Cash or Physical'
  },
  settlementTx: {
    pattern: /^[0-9]{1,2}$/,
    message: 'Settlement T+x must be a number between 0 and 99'
  },
  dates: {
    required: true,
    message: 'This date is required'
  },
  barrier: {
    pattern: /^[0-9]{1,3}(\.[0-9]{1,2})?$/,
    min: 0,
    max: 100,
    message: 'Barrier must be a percentage between 0 and 100'
  },
  coupon: {
    pattern: /^[0-9]{1,3}(\.[0-9]{1,4})?$/,
    min: 0,
    max: 100,
    message: 'Coupon must be a percentage between 0 and 100'
  }
};

function validateField(value, rule) {
  if (!value && rule.required) {
    return rule.message;
  }
  if (rule.pattern && !rule.pattern.test(value)) {
    return rule.message;
  }
  if (typeof rule.min === 'number' && parseFloat(value) < rule.min) {
    return `Value must be at least ${rule.min}`;
  }
  if (typeof rule.max === 'number' && parseFloat(value) > rule.max) {
    return `Value must not exceed ${rule.max}`;
  }
  return null;
}

function showFieldError($field, message) {
  $field.addClass('is-invalid');
  const $feedback = $field.siblings('.invalid-feedback');
  if ($feedback.length) {
    $feedback.text(message);
  } else {
    $field.after(`<div class="invalid-feedback">${message}</div>`);
  }
}

function clearFieldError($field) {
  $field.removeClass('is-invalid');
  $field.siblings('.invalid-feedback').remove();
}

function validateForm() {
  let isValid = true;
  
  // Clear all previous errors
  $('.is-invalid').removeClass('is-invalid');
  $('.invalid-feedback').remove();

  // Validate ISIN
  const $isin = $('#isin_code');
  const isinError = validateField($isin.val(), ValidationRules.isin);
  if (isinError) {
    showFieldError($isin, isinError);
    isValid = false;
  }

  // Validate Currency
  const $currency = $('#currency');
  const currencyError = validateField($currency.val(), ValidationRules.currency);
  if (currencyError) {
    showFieldError($currency, currencyError);
    isValid = false;
  }

  // Validate Issuer
  const $issuer = $('#issuer');
  const issuerError = validateField($issuer.val(), ValidationRules.issuer);
  if (issuerError) {
    showFieldError($issuer, issuerError);
    isValid = false;
  }

  // Validate Settlement Type
  const $settlementType = $('#settlement_type');
  const settlementTypeError = validateField($settlementType.val(), ValidationRules.settlementType);
  if (settlementTypeError) {
    showFieldError($settlementType, settlementTypeError);
    isValid = false;
  }

  // Validate Settlement T+x
  const $settlementTx = $('#settlement_tx');
  const settlementTxError = validateField($settlementTx.val(), ValidationRules.settlementTx);
  if (settlementTxError) {
    showFieldError($settlementTx, settlementTxError);
    isValid = false;
  }

  // Validate Required Dates
  ['#tradeDate', '#paymentDate', '#finalObservation', '#maturityDate'].forEach(dateId => {
    const $date = $(dateId);
    const dateError = validateField($date.val(), ValidationRules.dates);
    if (dateError) {
      showFieldError($date, dateError);
      isValid = false;
    }
  });

  // Validate Barriers
  const $couponBarrier = $('#phoenix_coupon_barrier');
  const couponBarrierError = validateField($couponBarrier.val(), ValidationRules.barrier);
  if (couponBarrierError) {
    showFieldError($couponBarrier, couponBarrierError);
    isValid = false;
  }

  const $capitalProtectionBarrier = $('#phoenix_capital_protection_barrier');
  const capitalProtectionBarrierError = validateField($capitalProtectionBarrier.val(), ValidationRules.barrier);
  if (capitalProtectionBarrierError) {
    showFieldError($capitalProtectionBarrier, capitalProtectionBarrierError);
    isValid = false;
  }

  // Validate Coupon
  const $couponPerPeriod = $('#phoenix_coupon_per_period');
  const couponError = validateField($couponPerPeriod.val(), ValidationRules.coupon);
  if (couponError) {
    showFieldError($couponPerPeriod, couponError);
    isValid = false;
  }

  // Validate Underlyings
  const $underlyings = $('#underlyingRowsContainer tr');
  if ($underlyings.length === 0) {
    showModal('Validation Error', 'At least one underlying is required');
    isValid = false;
  }

  return isValid;
}

Template.phoenixTemplate.events({
  'click #add_ticker'(event, template) {
    event.preventDefault();
    
    const underlyingsContainer = $('#underlyingRowsContainer');
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

    Blaze.renderWithData(Template.underlyingRow, templateData, underlyingsContainer[0]);

    updateSummary();
  },

  'click .remove_ticker'(event) {
    event.preventDefault();
    const rowId = $(event.currentTarget).data('id');
    $(`#tickerRow-${rowId}`).remove();
    updateSummary();
  },

  'change #phoenix_step_down'(event) {
    const isChecked = $(event.target).is(':checked');
    $('#phoenix_step_down_fields').toggle(isChecked);
    updateSummary();
  },

  'click #generateSchedule'(event) {
    event.preventDefault();
    
    const tradeDate = $('#tradeDate').val();
    const finalObservation = $('#finalObservation').val();
    
    if (!tradeDate || !finalObservation) {
      showModal('Warning', 'Please enter Trade Date and Final Observation Date first');
      return;
    }

    // Show the table header
    $('#scheduleTable thead').show();

    const scheduleContainer = $('#scheduleTable tbody');
    scheduleContainer.empty();

    const start = moment(tradeDate);
    const end = moment(finalObservation);
    const months = end.diff(start, 'months');
    const observationsCount = Math.floor(months / 3);

    // Get parameters
    const nonCallPeriods = parseInt($('#phoenix_non_call_periods').val()) || 0;
    const stepDownEnabled = $('#phoenix_step_down').is(':checked');
    const stepDownSize = stepDownEnabled ? parseFloat($('#phoenix_step_size').val()) : 0;
    const autocallLevel = parseFloat($('#phoenix_autocall_level').val()) || 100;
    const couponBarrier = $('#phoenix_coupon_barrier').val() || '';
    const couponPerPeriod = $('#phoenix_coupon_per_period').val() || '';

    // Get market holidays (you'll need to implement this)
    Meteor.call('getMarketHolidays', (error, holidays) => {
      if (error) {
        console.error('Error getting market holidays:', error);
        holidays = [];
      }

      for (let i = 1; i <= observationsCount; i++) {
        let observationDate = moment(tradeDate).add(i * 3, 'months');
        
        // Adjust observation date if it falls on weekend or holiday
        while (isWeekend(observationDate) || 
               holidays.some(h => moment(h).isSame(observationDate, 'day'))) {
          observationDate = getNextBusinessDay(observationDate, holidays);
        }

        // Payment date is 5 business days after observation date
        let paymentDate = moment(observationDate);
        for (let j = 0; j < 5; j++) {
          paymentDate = getNextBusinessDay(paymentDate, holidays);
        }
        
        // Calculate autocall barrier
        let currentAutocallBarrier = '';
        if (i > nonCallPeriods) {
          currentAutocallBarrier = autocallLevel;
          if (stepDownEnabled) {
            const stepsApplied = i - nonCallPeriods - 1;
            if (stepsApplied > 0) {
              currentAutocallBarrier = (autocallLevel - (stepsApplied * stepDownSize)).toFixed(2);
            }
          }
        }

        scheduleContainer.append(`
          <tr>
            <td>${i}</td>
            <td><input type="date" class="form-control observation-date" value="${observationDate.format('YYYY-MM-DD')}"></td>
            <td><input type="date" class="form-control payment-date" value="${paymentDate.format('YYYY-MM-DD')}"></td>
            <td><input type="text" class="form-control coupon-barrier" value="${couponBarrier}"></td>
            <td><input type="text" class="form-control autocall-barrier" value="${currentAutocallBarrier}"></td>
            <td><input type="text" class="form-control coupon-per-period" value="${couponPerPeriod}"></td>
          </tr>
        `);
      }

      updateSummary();
    });
  },

  'click #submitProduct'(event, template) {
    event.preventDefault();
    
    if (template.isSubmitting.get()) return;
    
    if (!validateForm()) {
      showModal('Validation Error', 'Please correct the errors in the form');
      return;
    }

    template.isSubmitting.set(true);

    try {
      const productData = gatherPhoenixData();
      const isin = $('#isin_code').val();
      
      if (!isin) {
        showModal('Warning', 'ISIN code is required');
        template.isSubmitting.set(false);
        return;
      }

      const queryParams = Router.current().params.query;
      const isEditMode = queryParams.mode === 'editProduct';
      
      if (isEditMode) {
        Meteor.call('updateProduct', productData._id, productData, (error, result) => {
          template.isSubmitting.set(false);
          if (error) {
            console.error('Error updating product:', error);
            showModal('Error', 'Error updating product: ' + error.reason);
          } else {
            showModal('Success', 'Product updated successfully', () => {
              Router.go('products');
            });
          }
        });
      } else {
        Meteor.call('insertProduct', productData, (error, result) => {
          template.isSubmitting.set(false);
          if (error) {
            console.error('Error inserting product:', error);
            showModal('Error', 'Error inserting product: ' + error.reason);
          } else {
            showModal('Success', 'Product inserted successfully', () => {
              Router.go('products');
            });
          }
        });
      }
    } catch (error) {
      template.isSubmitting.set(false);
      console.error('Error gathering product data:', error);
      showModal('Error', 'Error gathering product data: ' + error.message);
    }
  },

  'input #phoenix_capital_protection_barrier'(event) {
    updateSummary();
  },

  'change #jump'(event) {
    updateSummary();
  },

  'click .send-file'(event) {
    event.preventDefault();
    console.log('Send file clicked');
    
    const file = $('#pdfInput')[0].files[0];
    if (!file) {
      console.log('No file selected');
      return;
    }
    
    console.log('File details:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    const reader = new FileReader();
    
    reader.onerror = function(error) {
      console.error('FileReader error:', error);
      showModal('Error', 'Error reading file: ' + error.message);
    };

    reader.onload = function(e) {
      console.log('File read complete, size:', e.target.result.byteLength);
      const fileData = new Uint8Array(e.target.result);
      
      console.log('Calling processPdfWithAI method...');
      Meteor.call('processPdfWithAI', fileData, (error, result) => {
        if (error) {
          console.error('Error from processPdfWithAI:', error);
          const errorMessage = error.error === 'duplicate-isin' 
            ? error.reason 
            : 'Error processing PDF. Please try again or contact support.';
          showModal('Error', errorMessage);
        } else {
          console.log('PDF processed successfully:', result);
          const url = new URL('editProduct', window.location.origin);
          url.searchParams.set('mode', 'editProduct');
          url.searchParams.set('isin', result.isin);
          window.location.href = url.pathname + url.search;
        }
      });
    };

    console.log('Starting file read...');
    reader.readAsArrayBuffer(file);
  },

  'input .ticker-search'(event, template) {
    const searchTerm = event.target.value.trim();
    const resultsContainer = event.target.parentElement.querySelector('.ticker-search-results');
    
    if (searchTerm.length < 2) {
      resultsContainer.classList.add('d-none');
      return;
    }

    Meteor.call('searchTickers', searchTerm, (error, results) => {
      if (error) {
        console.error('Error searching tickers:', error);
        return;
      }
      
      // Clear previous results
      resultsContainer.innerHTML = '';
      
      // Add new results
      results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'ticker-result-item';
        resultItem.textContent = `${result.name} (${result.ticker})`;
        resultsContainer.appendChild(resultItem);
      });
      
      resultsContainer.classList.remove('d-none');
    });
  },

  'click .ticker-result-item'(event, template) {
    const selectedText = event.target.textContent;
    const row = event.target.closest('tr');
    const inputField = row.querySelector('.ticker-search');
    inputField.value = selectedText;
    
    // Parse the selected text to get ticker info
    const match = selectedText.match(/(.*?)\s*\((.*?)\)/);
    if (match) {
      const [_, name, ticker] = match;
      const [symbol, exchange] = ticker.split('.');
      
      // Update other fields in the row
      row.querySelector('[id^=tickerInput]').value = symbol;
      row.querySelector('[id^=exchangeInput]').value = exchange;
      
      // Get additional info for the ticker
      Meteor.call('getTickerInfo', ticker, (error, result) => {
        if (!error && result) {
          row.querySelector('[id^=countryInput]').value = result.country || '';
          row.querySelector('[id^=currencyInput]').value = result.currency || '';
          if (result.lastPrice) {
            row.querySelector('[id^=closeText]').textContent = result.lastPrice;
          }
        }
      });
    }
    
    // Hide results
    event.target.closest('.ticker-search-results').classList.add('d-none');
  },

  'blur .ticker-search'(event) {
    // Delay hiding to allow click event to fire
    setTimeout(() => {
      event.target.parentElement.querySelector('.ticker-search-results').classList.add('d-none');
    }, 200);
  },

  'input .fullName-autocomplete'(event, template) {
    const searchTerm = event.target.value.trim();
    const resultsContainer = event.target.parentElement.querySelector('#searchResultsList');
    const searchResultsDiv = event.target.parentElement.querySelector('#searchResults');
    
    if (searchTerm.length < 2) {
      searchResultsDiv.classList.add('d-none');
      return;
    }

    Meteor.call('searchTickers', searchTerm, (error, results) => {
      if (error) {
        console.error('Error searching tickers:', error);
        return;
      }
      
      // Clear previous results
      resultsContainer.innerHTML = '';
      
      // Add new results
      results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'list-group-item list-group-item-action bg-dark text-white border-secondary';
        item.textContent = `${result.name} (${result.ticker})`;
        resultsContainer.appendChild(item);
      });
      
      searchResultsDiv.classList.remove('d-none');
    });
  },

  'click .list-group-item'(event, template) {
    const selectedText = event.target.textContent;
    const row = event.target.closest('tr');
    const inputField = row.querySelector('.fullName-autocomplete');
    inputField.value = selectedText;
    
    // Parse the selected text to get ticker info
    const match = selectedText.match(/(.*?)\s*\((.*?)\)/);
    if (match) {
      const [_, name, ticker] = match;
      
      // Update other fields in the row
      row.querySelector('[id^=tickerInput]').value = ticker;  // Use full ticker
      row.querySelector('[id^=exchangeInput]').value = ticker.split('.')[1] || '';
      
      // Get additional info for the ticker and closing price
      row.querySelector('[id^=exchangeInput]').value = ticker.split('.')[1] || '';
      const tradeDate = $('#tradeDate').val(); // Get trade date from the form
      
      Meteor.call('getTickerInfo', ticker, tradeDate, (error, result) => {
        if (!error && result) {
          row.querySelector('[id^=countryInput]').value = result.country || '';
          row.querySelector('[id^=currencyInput]').value = result.currency || '';
          if (result.lastPrice) {
            row.querySelector('[id^=closeText]').textContent = result.lastPrice;
            row.querySelector('[id^=closeDateText]').textContent = result.date ? `(${result.date})` : '';
      
      // Get additional info for the ticker and closing price
            // Set the strike input to the closing price
            row.querySelector('[id^=strikeInput]').value = result.lastPrice;
          }
        }
      });
    }
    
    // Hide results
    event.target.closest('#searchResults').classList.add('d-none');
  },

  'blur #isin_code'(event) {
    const $field = $(event.target);
    const error = validateField($field.val(), ValidationRules.isin);
    if (error) {
      showFieldError($field, error);
    } else {
      clearFieldError($field);
    }
    // Auto uppercase ISIN
    $field.val($field.val().toUpperCase());
  },

  'input #isin_code'(event) {
    const $field = $(event.target);
    $field.val($field.val().toUpperCase());
  },

  'blur .form-control'(event) {
    const $field = $(event.target);
    const fieldId = $field.attr('id');
    let rule;

    switch(fieldId) {
      case 'currency':
        rule = ValidationRules.currency;
        break;
      case 'settlement_type':
        rule = ValidationRules.settlementType;
        break;
      case 'settlement_tx':
        rule = ValidationRules.settlementTx;
        break;
      case 'phoenix_coupon_barrier':
      case 'phoenix_capital_protection_barrier':
        rule = ValidationRules.barrier;
        break;
      case 'phoenix_coupon_per_period':
        rule = ValidationRules.coupon;
        break;
      // Add more cases as needed
    }

    if (rule) {
      const error = validateField($field.val(), rule);
      if (error) {
        showFieldError($field, error);
      } else {
        clearFieldError($field);
      }
    }
  }
});
// Make sure Template.phoenixTemplate.onCreated is defined
Template.phoenixTemplate.onCreated(function() {
  this.searchResults = new ReactiveVar([]);
  this.isSubmitting = new ReactiveVar(false);
  
  // Make sure we have a subscription handle
  this.issuersHandle = this.subscribe('issuers');
});

// Make sure Template.phoenixTemplate.onRendered is defined
Template.phoenixTemplate.onRendered(function() {
  // Any render-time initialization if needed
});

Template.phoenixTemplate.helpers({
  issuersReady() {
    const instance = Template.instance();
    return instance.issuersHandle && instance.issuersHandle.ready();
  },
  
  availableIssuers() {
    return Issuers.find({}, { sort: { name: 1 } }).fetch();
  },
  
  selected(issuerId) {
    const currentData = Template.currentData();
    const issuerValue = currentData?.genericData?.issuer || 
                       currentData?.productDetails?.genericInformation?.issuer;
    
    if (!issuerValue) return '';
    
    // If issuerValue matches the current ID directly
    if (issuerId === issuerValue) return 'selected';
    
    // If issuerValue is a name, check if it matches the current issuer's name
    const currentIssuer = Issuers.findOne(issuerId);
    return currentIssuer && currentIssuer.name === issuerValue ? 'selected' : '';
  },

  searchResults() {
    return Template.instance().searchResults.get();
  }
});


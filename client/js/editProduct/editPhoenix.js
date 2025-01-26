import { Router } from 'meteor/iron:router';
import { Template } from 'meteor/templating';
import moment from 'moment';
import '/client/html/templates/underlyingRow.html';
import { Issuers } from '/imports/api/issuers/issuers.js';
import { Products } from '/imports/api/products/products.js';
import { ReactiveVar } from 'meteor/reactive-var';

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
export function gatherPhoenixData(template) {
  const productData = {
    _id: null,
    status: "live",
    genericData: {},
    features: {},
    underlyings: [],
    observationDates: [],
    observationsTable: [],
    totalCouponPaid: 0
  };

  const currentProduct = template.product.get();
  if (!currentProduct?._id) {
    throw new Error('No product loaded');
  }

  productData._id = currentProduct._id;

  // Generic Data
  productData.genericData = {
    ISINCode: $('#isin_code').val()?.toUpperCase(),
    currency: $('#currency').val(),
    settlementType: $('#settlement_type').val(),
    settlementTx: $('#settlement_tx').val(),
    tradeDate: $('#tradeDate').val(),
    paymentDate: $('#paymentDate').val(),
    finalObservation: $('#finalObservation').val(),
    maturityDate: $('#maturityDate').val(),
    template: 'phoenix',
    nonCallPeriods: parseInt($('#phoenix_non_call_periods').val()) || 0,
    valoren: $('#valoren').val()
  };

  // Get issuer name from selected ID
  const issuerId = $('#issuer').val();
  const issuer = Issuers.findOne(issuerId);
  productData.genericData.issuer = issuer ? issuer.name : null;

  // Generate product name from underlyings
  const underlyings = getPhoenixUnderlyings();
  const underlyingNames = underlyings.map(u => u.ticker).join(' / ');
  const couponPerPeriod = parseFloat($('#phoenix_coupon_per_period').val());
  const maturityYear = moment(productData.genericData.maturityDate).year();
  productData.genericData.name = `Phoenix on ${underlyingNames} ${couponPerPeriod}% ${maturityYear}`;

  // Features
  productData.features = {
    memoryCoupon: $('#memoryCoupon').is(':checked'),
    memoryAutocall: $('#memoryAutocall').is(':checked'),
    oneStar: $('#oneStar').is(':checked'),
    lowStrike: $('#lowStrike').is(':checked'),
    autocallStepdown: $('#autocallStepdown').is(':checked'),
    jump: $('#jump').is(':checked'),
    stepDown: $('#phoenix_step_down').is(':checked'),
    stepDownSize: $('#phoenix_step_size').val(),
    couponBarrier: parseFloat($('#phoenix_coupon_barrier').val()),
    capitalProtectionBarrier: parseFloat($('#phoenix_capital_protection_barrier').val()),
    couponPerPeriod: parseFloat($('#phoenix_coupon_per_period').val()),
    observationFrequency: $('#phoenix_observation_frequency').val()
  };

  // Underlyings
  productData.underlyings = getPhoenixUnderlyings();

  // Observation Dates and Table
  const observationRows = $('#scheduleTable tbody tr');
  let totalCouponPaid = 0;

  productData.observationDates = [];
  productData.observationsTable = [];

  observationRows.each(function(index) {
    const $row = $(this);
    const observationDate = $row.find('.observation-date').val();
    const paymentDate = $row.find('.payment-date').val();
    const couponBarrier = parseFloat($row.find('.coupon-barrier').val());
    const autocallLevel = parseFloat($row.find('.autocall-barrier').val());
    const couponPerPeriod = parseFloat($row.find('.coupon-per-period').val());

    productData.observationDates.push({
      observationDate,
      paymentDate,
      couponBarrierLevel: couponBarrier,
      autocallLevel,
      couponPerPeriod
    });

    productData.observationsTable.push({
      n: index + 1,
      observationDate,
      paymentDate,
      couponPaid: couponPerPeriod,
      autocallLevel,
      couponBarrier,
      worstOfLevel: null,
      worstOfTicker: null
    });

    totalCouponPaid += couponPerPeriod || 0;
  });

  productData.totalCouponPaid = totalCouponPaid;

  // Preserve existing fields
  if (currentProduct) {
    productData.chart100 = currentProduct.chart100 || [];
    productData.chartOptions = currentProduct.chartOptions || {};
    productData.pnl = currentProduct.pnl;
    productData.redemptionIfToday = currentProduct.redemptionIfToday || 100;
    productData.autocallDate = currentProduct.autocallDate;
    productData.autocalled = currentProduct.autocalled || false;
    productData.capitalRedemption = currentProduct.capitalRedemption;
  }

  console.log('Gathered product data:', productData);
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
  const underlyingsContainer = getCachedSelector('#underlyingRowsContainer');
  populateTableRows(underlyingsContainer, underlyings, Template.underlyingRow);
}

function populatePhoenixObservations(observations) {
  console.log("Populating Phoenix observations:", observations);
  const scheduleContainer = getCachedSelector('#scheduleTable tbody');
  populateTableRows(scheduleContainer, observations, Template.observationRow);
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
  showLoading();

  // Generic Data
  $('#isin_code').val(product.genericData.ISINCode);
  $('#currency').val(product.genericData.currency);
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

  // Populate underlyings and observations
  if (product.underlyings?.length) populatePhoenixUnderlyings(product.underlyings);
  if (product.observationDates?.length) populatePhoenixObservations(product.observationDates);

  updateSummary();
  hideLoading();
}

// Utility function to cache jQuery selectors
function getCachedSelector(selector) {
    if (!getCachedSelector.cache) {
        getCachedSelector.cache = {};
    }
    if (!getCachedSelector.cache[selector]) {
        getCachedSelector.cache[selector] = $(selector);
    }
    return getCachedSelector.cache[selector];
}

// Utility function for date handling
function adjustDateForBusinessDay(date, holidays = []) {
    let adjustedDate = moment(date);
    while (isWeekend(adjustedDate) || holidays.some(h => moment(h).isSame(adjustedDate, 'day'))) {
        adjustedDate = getNextBusinessDay(adjustedDate, holidays);
    }
    return adjustedDate;
}

// Utility function for populating table rows
function populateTableRows(container, data, template) {
    container.empty();
    data.forEach((item, index) => {
        const renderedTemplate = Blaze.toHTMLWithData(template, { ...item, index: index + 1 });
        container.append(renderedTemplate);
    });
}

// Utility function for showing modals
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
  },

  'click #submitProduct'(event, template) {
    event.preventDefault();
    
    // Show loading state
    showLoading();
    
    try {
      // Validate form first
      if (!validateForm()) {
        hideLoading();
        showModal('Validation Error', 'Please check all required fields');
        return;
      }

      // Gather product data
      const productData = {
        genericData: {
          ISINCode: $('#isin_code').val()?.toUpperCase(),
          currency: $('#currency').val(),
          issuer: $('#issuer option:selected').text(),
          settlementType: $('#settlement_type').val(),
          settlementTx: parseInt($('#settlement_tx').val()),
          tradeDate: $('#tradeDate').val(),
          paymentDate: $('#paymentDate').val(),
          finalObservation: $('#finalObservation').val(),
          maturityDate: $('#maturityDate').val(),
          valoren: $('#valoren').val(),
          template: 'phoenix'
        },
        features: {
          memoryCoupon: $('#memoryCoupon').is(':checked'),
          memoryAutocall: $('#memoryAutocall').is(':checked'),
          oneStar: $('#oneStar').is(':checked'),
          lowStrike: $('#lowStrike').is(':checked'),
          autocallStepdown: $('#autocallStepdown').is(':checked'),
          jump: $('#jump').is(':checked'),
          stepDown: $('#phoenix_step_down').is(':checked'),
          stepDownSize: parseFloat($('#phoenix_step_size').val()),
          couponBarrier: parseFloat($('#phoenix_coupon_barrier').val()),
          capitalProtectionBarrier: parseFloat($('#phoenix_capital_protection_barrier').val()),
          couponPerPeriod: parseFloat($('#phoenix_coupon_per_period').val())
        },
        underlyings: [],
        observationDates: []
      };

      // Gather underlyings data first
      $('#underlyingRowsContainer tr').each(function() {
        const underlying = {
          name: $(this).find('.fullName-autocomplete').val(),
          ticker: $(this).find('[id^=tickerInput]').val(),
          exchange: $(this).find('[id^=exchangeInput]').val(),
          country: $(this).find('[id^=countryInput]').val(),
          currency: $(this).find('[id^=currencyInput]').val(),
          initialReferenceLevel: parseFloat($(this).find('[id^=strikeInput]').val()),
          eodTicker: $(this).find('[id^=tickerInput]').val()
        };
        productData.underlyings.push(underlying);
      });

      // Generate product name
      const underlyingTickers = productData.underlyings.map(u => u.ticker).join(' / ');
      const maturityYear = moment(productData.genericData.maturityDate).format('YYYY');
      const couponPerPeriod = productData.features.couponPerPeriod;
      productData.genericData.name = `Phoenix on ${underlyingTickers} ${couponPerPeriod}% ${maturityYear}`;

      // Gather observation dates
      $('#scheduleTable tbody tr').each(function() {
        const observation = {
          observationDate: $(this).find('.observation-date').val(),
          paymentDate: $(this).find('.payment-date').val(),
          couponBarrierLevel: parseFloat($(this).find('.coupon-barrier').val()),
          autocallLevel: parseFloat($(this).find('.autocall-barrier').val()),
          couponPerPeriod: parseFloat($(this).find('.coupon-per-period').val())
        };
        productData.observationDates.push(observation);
      });

      // Call the server method
      Meteor.call('insertProduct', productData, (error, result) => {
        hideLoading();
        
        if (error) {
          console.error('Error inserting product:', error);
          showModal('Error', error.reason || 'Failed to insert product');
          return;
        }

        // Show success message and redirect with page reload
        showModal('Success', 'Product inserted successfully', () => {
          window.location.href = '/products'; // Full page reload to products page
        });
      });

    } catch (error) {
      hideLoading();
      console.error('Error gathering product data:', error);
      showModal('Error', 'Failed to gather product data');
    }
  }
});

Template.phoenixTemplate.onCreated(function() {
  console.log('Phoenix template created');
  
  // Initialize ReactiveVars
  this.product = new ReactiveVar({}); // Initialize with empty object for new products
  this.issuerName = new ReactiveVar(null);
  
  // Track changes to the product data context
  this.autorun(() => {
    const data = Template.currentData();
    console.log('Phoenix template data context:', data);
    
    if (data?.product) {
      console.log('Setting product in template:', data.product);
      this.product.set(data.product);
      
      // Set issuer name from product
      if (data.product.genericData?.issuer) {
        this.issuerName.set(data.product.genericData.issuer);
      }
    }
  });

  // Subscribe to issuers collection
  this.subscribe('issuers');
});

Template.phoenixTemplate.helpers({
  availableIssuers() {
    return Issuers.find({}, { sort: { name: 1 } }).fetch();
  },
  
  selectedIssuer(issuerId) {
    const instance = Template.instance();
    const issuerName = instance.issuerName.get();
    if (!issuerName) return '';
    
    const issuer = Issuers.findOne({ _id: issuerId });
    return issuer?.name === issuerName ? 'selected' : '';
  }
});

Template.phoenixTemplate.onRendered(function() {
  console.time('phoenixTemplate-rendered');
  console.log('Phoenix template rendering...');

  // Set initial issuer value once data is ready
  this.autorun(() => {
    const issuerName = this.issuerName.get();
    if (issuerName && this.subscriptionsReady()) {
      Tracker.afterFlush(() => {
        const issuer = Issuers.findOne({ name: issuerName });
        if (issuer) {
          const $select = $('#issuer');
          if ($select.find('option').length > 1) {
            $select.val(issuer._id);
          } else {
            // Retry if options aren't loaded yet
            Meteor.setTimeout(() => {
              $select.val(issuer._id);
            }, 100);
          }
        }
      });
    }
  });

  console.timeEnd('phoenixTemplate-rendered');
});

// Add these helper functions at the top level
function showLoading() {
  $('#loadingBackdrop').show().addClass('show');
}

function hideLoading() {
  $('#loadingBackdrop').removeClass('show').hide();
}

// Add CSS styles for the backdrop
const style = document.createElement('style');
style.textContent = `
  #loadingBackdrop {
    background: rgba(0, 0, 0, 0.5);
    z-index: 1050;
  }
  
  #loadingBackdrop .spinner-border {
    width: 3rem;
    height: 3rem;
  }
`;
document.head.appendChild(style);

Template.editPhoenix.onCreated(function() {
  this.currentProduct = new ReactiveVar(null);
  this.productReady = new ReactiveVar(false);
  this.issuerReady = new ReactiveVar(false);

  // Subscribe to issuers first
  this.autorun(() => {
    const issuerSub = Meteor.subscribe('issuers');
    this.issuerReady.set(issuerSub.ready());
  });

  // Get ISIN from URL params
  const isin = Router.current().params.query.isin;
  if (isin) {
    console.log('Loading product for ISIN:', isin);
    
    // Subscribe to product details
    this.subscribe('productDetails', isin, {
      onReady: () => {
        const product = Products.findOne({
          $or: [
            { "genericData.ISINCode": isin },
            { "ISINCode": isin }
          ]
        });
        
        console.log('Product loaded:', product);
        if (product) {
          this.currentProduct.set(product);
        }
        this.productReady.set(true);
      }
    });
  } else {
    this.productReady.set(true);
  }
});

Template.editPhoenix.helpers({
  isLoading() {
    const instance = Template.instance();
    return !instance.productReady.get() || !instance.issuerReady.get();
  },
  currentProduct() {
    // Return the actual product object, not the ReactiveVar
    return Template.instance().currentProduct.get();
  }
});


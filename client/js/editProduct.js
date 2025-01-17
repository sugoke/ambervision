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

import { ReactiveDict } from 'meteor/reactive-dict';

import '../html/templates/editPhoenix.html';
import '../html/templates/editOrion.html';
import '../html/templates/editTwinWin.html';
import '../js/editProduct/editPhoenix.js';
import { updateSummary, updateSummarySchedule, gatherPhoenixData, populatePhoenixUnderlyings, populatePhoenixFormFields, populatePhoenixObservations } from '../js/editProduct/editPhoenix.js';
import { gatherOrionData, populateOrionUnderlyings, populateOrionFormFields } from '../js/editProduct/editOrion.js';
import { gatherTwinWinData, populateTwinWinUnderlyings, populateTwinWinFormFields } from '../js/editProduct/editTwinWin.js';
import '../js/templates/underlyingRow.js';


if (Template.observationRow) {
  Template.observationRow.helpers({
    disabledIf(observation) {
      return observation.disabled ? 'disabled' : '';
    }
  });
}

// Global helpers
Template.registerHelper('selected', function(current, expected) {
  return current === expected ? 'selected' : '';
});

// On your client side
let isSubmitting = false;

// Add this function at the top level of your editProduct.js file
function updateSummaryUnderlyings() {
  const underlyingsContainer = $('#summaryUnderlyings');
  underlyingsContainer.empty();

  $('#underlyingRowsContainer tr').each(function(index) {
    const ticker = $(this).find('[id^=tickerInput-]').val();
    const fullName = $(this).find('[id^=fullNameInput-]').val();
    const strike = $(this).find('[id^=strikeInput-]').val();

    const underlyingHtml = `
      <tr>
        <td>${index + 1}</td>
        <td>${ticker}</td>
        <td>${fullName}</td>
        <td>${strike}</td>
      </tr>
    `;

    underlyingsContainer.append(underlyingHtml);
  });
}

Template.editProduct.helpers({
  genericInformation() {
  const isin = Session.get('currentISIN');
  const product = Products.findOne({ 'genericInformation.ISINCode': isin });
  return product && product.genericInformation;
},
specificInformation() {
  const isin = Session.get('currentISIN');
  const product = Products.findOne({ 'genericInformation.ISINCode': isin });
  return product && product.specificInformation;
},
isChecked(value) {
  return value ? 'checked' : '';
},
  isEditMode() {
    return Template.instance().isEditMode.get();
  },

  tickers() {
    return Template.instance().tickers.get();
  },

  productData() {
    const productData = Template.instance().productData.get();
    console.log("productData:", productData);
    return productData;
  },

  observations() {
     return Template.instance().observations.get();
   },

  disabledIfEditMode() {
    return Template.instance().isEditMode.get() ? 'disabled' : '';
  },

  productTypeTemplate() {
    const productType = Template.instance().productType.get();
    switch (productType) {
      case 'phoenix':
        return 'phoenixTemplate';
      case 'orion':
        return 'orionTemplate';
      case 'twinWin':
        return 'twinWinTemplate';
      default:
        return null;
    }
  },

  currentTemplate() {
    const template = Template.instance().state.get('currentTemplate');
    console.log("Current template:", template);
    return template;
  },

  disabledAttribute() {
    return Template.instance().isEditMode.get() ? 'disabled' : '';
  },

  uploadedFile() {
    return Template.instance().uploadedFile.get();
  },

  showUploadCard() {
    const queryParams = Router.current().params.query;
    return !(queryParams.mode === 'editProduct' && queryParams.isin);
  },

  uploadProgress() {
    return Template.instance().uploadProgress.get();
  },

  uploadStatus() {
    return Template.instance().uploadStatus.get();
  }
});

Template.editProduct.onCreated(function() {
  this.state = new ReactiveDict();
  this.state.setDefault({
    currentTemplate: null,
  });

  this.isEditMode = new ReactiveVar(false);
  this.productType = new ReactiveVar(null);
  this.tickers = new ReactiveVar([]);
  this.observations = new ReactiveVar([]);
  this.uploadedFile = new ReactiveVar(null);
  this.uploadProgress = new ReactiveVar(0);
  this.uploadStatus = new ReactiveVar('');

  const queryParams = Router.current().params.query;
  console.log("Query params:", queryParams);

  if (queryParams.mode === 'editProduct' && queryParams.isin) {
    console.log("Edit mode detected. ISIN:", queryParams.isin);
    this.isEditMode.set(true);
    const isin = queryParams.isin;

    // Subscribe to product data
    this.subscribe('productDetails', isin, () => {
      const product = Products.findOne({
        $or: [
          { "genericData.ISINCode": isin },
          { "ISINCode": isin }
        ]
      });
      
      if (product) {
        console.log('Product fetched successfully:', product);
        
        // Store product data first
        this.productId = new ReactiveVar(product._id);
        this.productData = new ReactiveVar(product);
        this.tickers = new ReactiveVar(product.underlyings || []);
        this.observations = new ReactiveVar(product.observationDates || []);
        
        // Set product type and update template
        const template = product.genericData?.template || product.template;
        console.log("Setting product type to:", template);
        this.productType.set(template);
        
        // Let the template render first
        Tracker.afterFlush(() => {
          $('#product_type').val(template).trigger('change');
          
          // Wait for template to be fully rendered
          setTimeout(() => {
            if (template === 'phoenix') {
              populatePhoenixFormFields(product);
            }
          }, 100);
        });
      }
    });
  } else if (queryParams.mode === 'newProduct') {
    console.log("New product mode detected");
    this.isNewProduct = new ReactiveVar(true);
  }
});

Template.editProduct.onRendered(function() {
  const productTypeSelect = this.find('#product_type');

  console.log('Template rendered, attaching event listener to #product_type');

  const loadTemplate = () => {
    const selectedType = productTypeSelect.value;
    console.log('Loading template for selected type:', selectedType);
    if (selectedType) {
      let templateName;
      switch(selectedType) {
        case 'phoenix':
          templateName = 'phoenixTemplate';
          break;
        case 'orion':
          templateName = 'orionTemplate';
          break;
        case 'twinWin':
          templateName = 'twinWinTemplate';
          break;
        default:
          templateName = null;
      }
      console.log('Setting currentTemplate to:', templateName);
      this.state.set('currentTemplate', templateName);
    }
  };

  productTypeSelect.addEventListener('change', loadTemplate);

  // Load template for edit mode or if a product type is already selected
  if (this.isEditMode.get()) {
    Tracker.autorun(() => {
      if (this.productType.get()) {
        loadTemplate();
      }
    });
  } else if (productTypeSelect.value) {
    loadTemplate();
  }

  // Add these helpers to ensure the templates are properly defined
  Template.phoenixTemplate.helpers({});
  Template.orionTemplate.helpers({});
  Template.twinWinTemplate.helpers({});

  updateSummary();

  // Disable the product type dropdown in edit mode
  if (this.isEditMode.get()) {
    $('#product_type').prop('disabled', true);
  }

  this.autorun(() => {
    if (this.subscriptionsReady()) {
      updateSummary();
    }
  });

  // Initialize the product type if it's already selected (e.g., in edit mode)
  const initialProductType = $(productTypeSelect).val();
  if (initialProductType) {
    $(productTypeSelect).trigger('change');
  }

  console.log('editProduct template rendered');

  console.log('Individual template helpers defined');

  // Ensure the initial state is correct
  const isStepDownChecked = this.$('#step_down').is(':checked');
  this.$('#step_down_mechanism').prop('checked', isStepDownChecked);
  if (isStepDownChecked) {
    this.$('#step_down_fields').show();
    this.$('#step_down_fields_mechanism').show();
  }

  // If we're in edit mode, wait for the product type to be set
  if (this.isEditMode.get()) {
    this.autorun(() => {
      const productType = this.productType.get();
      if (productType) {
        console.log('Setting product type select to:', productType);
        $(productTypeSelect).val(productType);
        
        // Set the template
        let templateName;
        switch(productType) {
          case 'phoenix':
            templateName = 'phoenixTemplate';
            break;
          case 'orion':
            templateName = 'orionTemplate';
            break;
          case 'twinWin':
            templateName = 'twinWinTemplate';
            break;
        }
        if (templateName) {
          this.state.set('currentTemplate', templateName);
        }
      }
    });
  }
});

Template.editProduct.events({
  // Add these event handlers
  'dragover #dragArea, dragenter #dragArea'(event) {
    event.preventDefault();
    event.stopPropagation();
    $(event.currentTarget).addClass('drag-drag-over');
  },

  'dragleave #dragArea, dragend #dragArea'(event) {
    event.preventDefault();
    event.stopPropagation();
    $(event.currentTarget).removeClass('drag-drag-over');
  },

  'drop #dragArea'(event, template) {
    event.preventDefault();
    event.stopPropagation();
    $(event.currentTarget).removeClass('drag-drag-over');

    const file = event.originalEvent.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      template.uploadedFile.set(file);
    }
  },

  'click .browse-btn'(event) {
    event.preventDefault();
    $('#pdfInput').click();
  },

  'change #pdfInput'(event, template) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
      template.uploadedFile.set(file);
    }
  },

  'click .remove-file'(event, template) {
    event.preventDefault();
    template.uploadedFile.set(null);
    $('#pdfInput').val('');
  },

  'click .send-file'(event, template) {
    event.preventDefault();
    const file = template.uploadedFile.get();
    if (!file) {
      $('#warningModal').find('.modal-body').text('Please select a file first');
      $('#warningModal').modal('show');
      return;
    }

    // Show loading state
    const $button = $(event.currentTarget);
    const originalText = $button.html();
    $button.prop('disabled', true)
           .html('<i class="fas fa-spinner fa-spin me-2"></i>Uploading...');

    template.uploadProgress.set(10);
    template.uploadStatus.set('Reading file...');

    const reader = new FileReader();
    reader.onload = function(e) {
      template.uploadProgress.set(30);
      template.uploadStatus.set('Processing PDF...');
      
      const arrayBuffer = e.target.result;
      const fileData = new Uint8Array(arrayBuffer);

      Meteor.call('processPdfWithAI', fileData, (error, result) => {
        if (error) {
          template.uploadProgress.set(0);
          template.uploadStatus.set('');
          $button.prop('disabled', false).html(originalText);
          console.error('Upload failed:', error);
          $('#warningModal').find('.modal-body').text('Failed to process term sheet: ' + error.reason);
          $('#warningModal').modal('show');
        } else {
          template.uploadProgress.set(100);
          template.uploadStatus.set('Success!');
          console.log('Upload successful:', result);
          
          // Clear the upload form after a short delay
          setTimeout(() => {
            template.uploadedFile.set(null);
            template.uploadProgress.set(0);
            template.uploadStatus.set('');
            $('#pdfInput').val('');
            
            if (result.isin) {
              window.location.href = `/editProduct?isin=${result.isin}&mode=editProduct`;
            }
          }, 1000);
        }
      });
    };

    reader.onerror = function(error) {
      template.uploadProgress.set(0);
      template.uploadStatus.set('');
      $button.prop('disabled', false).html(originalText);
      console.error('Error reading file:', error);
      $('#warningModal').find('.modal-body').text('Error reading file');
      $('#warningModal').modal('show');
    };

    reader.readAsArrayBuffer(file);
  },

  'click #add_ticker'(event, template) {
    event.preventDefault();
    const currentTickers = template.tickers.get() || [];
    const newId = currentTickers.length + 1;
    
    currentTickers.push({
      id: newId,
      fullName: '',
      ticker: '',
      exchange: '',
      country: '',
      currency: '',
      strike: ''
    });
    
    template.tickers.set(currentTickers);
    
    // Wait for DOM update then initialize autocomplete
    Tracker.afterFlush(() => {
      const newRow = document.querySelector(`#tickerRow-${newId}`);
      if (newRow) {
        const inputs = newRow.querySelectorAll('.fullName-autocomplete, .ticker-autocomplete');
        inputs.forEach(input => {
          $(input).trigger('focus');
        });
      }
    });
  }
  // ... other existing events ...
});

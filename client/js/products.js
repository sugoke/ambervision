import { $ } from 'meteor/jquery'; // Import jQuery
import { Template } from 'meteor/templating';
import dataTablesBootstrap from 'datatables.net-bs';
import 'datatables.net-bs/css/dataTables.bootstrap.css';
import 'datatables.net-buttons';
import 'datatables.net-buttons/js/buttons.colVis.js';
import 'datatables.net-buttons-dt/css/buttons.dataTables.css';
import { Modal } from 'bootstrap';
dataTablesBootstrap(window, $);

import { Holdings, Products } from '/imports/api/products/products.js';
import '../html/products.html';
import '/imports/tabular-tables.js';

import { TabularTables } from '/imports/tabular-tables.js';
import { ReactiveVar } from 'meteor/reactive-var';

Template.products.onCreated(function () {
  const instance = this;
  instance.selectedClientId = new ReactiveVar(null);
  instance.productToDelete = new ReactiveVar(null);
  
  const parentData = Template.parentData();
  if (parentData && parentData.selectedClientId) {
    instance.selectedClientId.set(parentData.selectedClientId);
  }
});

Template.products.helpers({
  productsAvailable() {
    const userId = Meteor.userId();
    const user = Meteor.users.findOne(userId);

    console.log('User object:', user);

    const isSuperAdmin = user?.profile?.role === 'superAdmin';
    console.log('Is Super Admin:', isSuperAdmin);

    if (isSuperAdmin) {
      const count = Products.find({ status: { $exists: true } }).count();
      console.log('Total Products for Super Admin:', count);
      return count > 0;
    }

    const userHoldings = Holdings.find({ userId }).fetch();
    const userIsins = userHoldings.map(holding => holding.isin);
    console.log('User Holdings ISINs:', userIsins);
    
    const count = Products.find({
      'genericData.ISINCode': { $in: userIsins },
      status: { $exists: true }
    }).count();
    console.log('Total Products for User:', count);
    return count > 0;
  },

  productsTable() {
    return TabularTables.Products;
  }
});

Template.products.onRendered(function () {
  this.autorun(() => {
    const user = Meteor.users.findOne(Meteor.userId());
    const isSuperAdmin = user?.profile?.role === 'superAdmin';

    console.log('Rendering Products Table');
    console.log('Is Super Admin:', isSuperAdmin);

    if ($.fn.DataTable.isDataTable('#productsTable')) {
      const tableInstance = $('#productsTable').DataTable();
      console.log('Table found, destroying existing DataTable');
      tableInstance.destroy();
      $('#productsTable').empty();
    } else {
      console.log('No existing DataTable instance found');
    }

    let query = { status: { $exists: true } };
    
    if (!isSuperAdmin) {
      const userHoldings = Holdings.find({ userId: Meteor.userId() }).fetch();
      const userIsins = userHoldings.map(h => h.isin);
      query['genericData.ISINCode'] = { $in: userIsins };
      console.log('Query for User:', query);
    } else {
      console.log('Query for Super Admin:', query);
    }

    const products = Products.find(query).fetch();
    console.log('Products before DataTable:', products);
    
    try {
      if (products.length > 0) {
        console.log('Preparing to initialize DataTable with products:', products);

        const columns = [
          { 
            data: 'genericData.ISINCode',
            title: 'ISIN',
            render: function(data, type, row) {
              if (type === 'display' && data) {
                const path = Router.path('productDetails', {}, { query: `isin=${data}` });
                return `<a href="${path}" class="btn btn-outline-warning btn-sm isin-btn">${data}</a>`;
              }
              return data || '';
            }
          },
          { 
            data: 'genericData.name',
            title: 'Product Name'
          },
          { 
            data: 'genericData.currency',
            title: 'Currency',
            className: 'text-center'
          },
          { 
            data: 'genericData.issuer',
            title: 'Issuer'
          },
          { 
            data: 'status',
            title: 'Status',
            className: 'text-center',
            render: function(data, type, row) {
              if (type === 'display') {
                let badgeClass = '';
                let displayText = data || 'Unknown';
                
                switch(data?.toLowerCase()) {
                  case 'live':
                    badgeClass = 'bg-success';
                    break;
                  case 'pending':
                    badgeClass = 'bg-warning';
                    break;
                  case 'active':
                    badgeClass = 'bg-primary';
                    break;
                  case 'autocalled':
                    badgeClass = 'bg-danger';
                    displayText = 'Auto-Called';
                    break;
                  default:
                    badgeClass = 'bg-secondary';
                }
                
                return `<span class="badge ${badgeClass}">${displayText}</span>`;
              }
              return data || '';
            }
          },
          { 
            data: null,
            title: isSuperAdmin ? 'Total Nominal' : 'Nominal Invested',
            className: 'text-end',
            render: function(data, type, row) {
              if (isSuperAdmin) {
                const holdings = Holdings.find({ 
                  isin: row.genericData.ISINCode 
                }).fetch();
                const total = holdings.reduce((sum, holding) => sum + (holding.quantity || 0), 0);
                return total ? total.toLocaleString() : '0';
              } else {
                const holding = Holdings.findOne({ 
                  userId: Meteor.userId(), 
                  isin: row.genericData.ISINCode 
                });
                return holding ? holding.quantity.toLocaleString() : '0';
              }
            }
          }
        ];

        if (isSuperAdmin) {
          columns.push({
            data: null,
            title: 'Actions',
            orderable: false,
            className: 'text-center',
            render: function(data, type, row) {
              return `<button class="btn btn-danger btn-sm delete-product" data-id="${row._id}">
                <i class="fas fa-trash"></i>
              </button>`;
            }
          });
        }

        $('#productsTable').DataTable({
          data: products.map(product => {
            // Transform chart100 data to avoid using tickers as keys
            if (product.chart100) {
              product.chart100 = product.chart100.map(point => ({
                ...point,
                values: Object.entries(point.values).map(([ticker, value]) => ({
                  ticker,
                  value
                }))
              }));
            }
            
            return {
              _id: product._id,
              genericData: {
                ISINCode: product.genericData.ISINCode,
                name: product.genericData.name,
                currency: product.genericData.currency,
                issuer: product.genericData.issuer
              },
              status: product.status,
              chart100: product.chart100
            };
          }),
          columns: columns,
          order: [[1, 'asc']],
          pageLength: 25,
          responsive: true,
          dom: "<'row mb-3'<'col-sm-12 col-md-6'f><'col-sm-12 col-md-6 text-end'B>>" +
               "<'row mt-3'<'col-sm-12'tr>>" +
               "<'row mt-3'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7'p>>",
          buttons: ['copy', 'csv', 'excel', 'pdf', 'print'],
          initComplete: function(settings, json) {
            console.log('DataTable initComplete. Settings:', settings);
            console.log('Data returned:', json);
          }
        });
      } else {
        console.log('No products to display.');
      }
    } catch (error) {
      console.error('DataTable error:', error);
      console.log('Products causing error:', products);
    }
  });
});

Template.products.events({
  'click .delete-product'(event, template) {
    event.preventDefault();
    const productId = event.currentTarget.getAttribute('data-id');
    template.productToDelete.set(productId);
    
    const modal = new Modal(document.getElementById('deleteProductModal'));
    modal.show();
  },

  'click #confirmDelete'(event, template) {
    const productId = template.productToDelete.get();
    
    Meteor.call('deleteProduct', productId, (error) => {
      const modal = Modal.getInstance(document.getElementById('deleteProductModal'));
      modal.hide();
      
      if (error) {
        alert('Error deleting product: ' + error.reason);
      }
    });
  }
});

Template.products.onDestroyed(function () {
  console.log('=== Template.products.onDestroyed ===');
  const table = $('#productsTable').DataTable();
  if (table) {
    console.log('Destroying DataTable');
    table.destroy();
  }
});

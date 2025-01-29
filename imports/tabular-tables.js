import { Tabular } from 'meteor/aldeed:tabular';
import { Products, Holdings, Prices } from '/imports/api/products/products.js';
import { Meteor } from 'meteor/meteor';
import { ReactiveVar } from 'meteor/reactive-var';
import { Tracker } from 'meteor/tracker';
import { Session } from 'meteor/session';

export const TabularTables = {};

TabularTables.Products = new Tabular.Table({
  name: "Products",
  collection: Products,
  pub: "clientProducts",
  columns: [
    { 
      data: "genericData.ISINCode",
      title: "ISIN",
      render: function(val, type, doc) {
        if (type === 'display') {
          return `<a href="#" onclick="event.preventDefault(); Router.go('productDetails', {}, {query: {isin: '${val}'}}); return false;" class="btn btn-outline-theme btn-sm isin-btn">${val}</a>`;
        }
        return val;
      }
    },
    { 
      data: "name",
      title: "Product Name"
    },
    { 
      data: "currency",
      title: "Currency",
      className: 'text-center'
    },
    { 
      data: "issuer",
      title: "Issuer"
    },
    { 
      data: "status",
      title: "Status",
      className: 'text-center',
      render: function(val, type, doc) {
        if (type === 'display') {
          let badgeClass = '';
          switch(val?.toLowerCase()) {
            case 'live':
              badgeClass = 'badge bg-success';
              break;
            case 'pending':
              badgeClass = 'badge bg-warning';
              break;
            case 'expired':
              badgeClass = 'badge bg-danger';
              break;
            default:
              badgeClass = 'badge bg-secondary';
          }
          return `<span class="${badgeClass}">${val || 'Unknown'}</span>`;
        }
        return val;
      }
    },
    { 
      data: null,
      title: "Nominal Invested",
      className: 'text-end',
      render: function(val, type, doc) {
        if (!Meteor.isClient) return '';
        const holding = Holdings.findOne({ 
          userId: Meteor.userId(), 
          isin: doc.genericData.ISINCode 
        });
        return holding ? holding.quantity.toLocaleString() : '';
      }
    },
    { 
      data: null,
      title: "Current Price",
      className: 'text-end',
      render: function(val, type, doc) {
        if (!Meteor.isClient) return '';
        const price = Prices.findOne({ isin: doc.genericData.ISINCode });
        if (price && price.bid) {
          return price.bid.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          });
        }
        return '';
      }
    }
  ],
  extraFields: ['genericData'],
  responsive: true,
  autoWidth: false,
  order: [[1, 'asc']],  // Sort by Product Name by default
  selector(userId) {
    const user = Meteor.users.findOne(userId);
    
    if (typeof Session === 'undefined') {
      return {};  // Return default selector on server-side
    }

    const selectedClientId = Session.get('selectedClientId');
    const isSuperAdmin = user?.profile?.role === 'superAdmin';

    if (isSuperAdmin && !selectedClientId) {
      return {};  // Show all products for superAdmin
    }

    const targetUserId = selectedClientId || userId;
    const holdings = Holdings.find({ userId: targetUserId }).fetch();
    const productIds = holdings.map(h => h.productId);

    return { _id: { $in: productIds } };
  }
});

console.log('TabularTables.Products initialized');

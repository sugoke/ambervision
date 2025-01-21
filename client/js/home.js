import { Template } from 'meteor/templating';
import { Products, Holdings, Risk, Schedules, Issuers } from '/imports/api/products/products.js';
import moment from 'moment';
import '../html/home.html';
import { renderBubbleChart } from './modular/bubbleChartHome.js';
import Chart from 'chart.js/auto';


Template.home.onCreated(function() {
  this.autorun(() => {
    const selectedUserId = Session.get('selectedClientId');
    const user = Meteor.user();
    
    if (user?.profile?.role === 'superAdmin' && !selectedUserId) {
      this.subscribe('clientFilteredProducts', null);
    } else if (selectedUserId) {
      this.subscribe('clientFilteredProducts', selectedUserId);
    }
  });
});

Template.home.helpers({
  isSuperAdmin() {
    return Meteor.user()?.profile?.role === 'superAdmin';
  },

  filteredRiskData() {
    if (!Meteor.user()) return [];
    return Risk.find().fetch()
      .map(risk => ({
        ISINCode: risk.ISINCode,
        underlyingName: risk.underlyingName,
        performance: risk.performance || 0,
        distanceToBarrier: risk.distanceToBarrier || 0,
        ticker: risk.underlyingEodticker
      }))
      .sort((a, b) => a.performance - b.performance);
  },

  liveProductsNominalValue() {
    const user = Meteor.user();
    if (!user) return 'Loading...';

    let totalValue = 0;
    const query = user.profile?.role === 'superAdmin' ? {} : { userId: user._id };
    
    Holdings.find(query).forEach(holding => {
      const product = Products.findOne({ 'genericData.ISINCode': holding.isin });
      if (product?.genericData?.nominalAmount) {
        totalValue += parseInt(product.genericData.nominalAmount);
      }
    });

    return totalValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  liveProductsCount() {
    const user = Meteor.user();
    if (!user) return 'Loading...';

    console.log('Counting live products:', {
      userRole: user?.profile?.role,
      isSuperAdmin: user?.profile?.role === 'superAdmin',
      user: user
    });

    if (user.profile?.role === 'superAdmin') {
      const count = Products.find({ status: 'live' }).count();
      console.log('SuperAdmin products count:', count);
      return count;
    }

    const holdings = Holdings.find({ userId: user._id }).fetch();
    const isins = holdings.map(h => h.isin);
    console.log('User holdings ISINs:', isins);

    const count = Products.find({
      'genericData.ISINCode': { $in: isins },
      status: 'live'
    }).count();
    
    console.log('User products count:', count);
    return count;
  },

  scheduleEvents() {
    const user = Meteor.user();
    if (!user) return [];

    const selectedUserId = Session.get('selectedClientId');
    let events = [];
    if (user?.profile?.role === 'superAdmin' && !selectedUserId) {
      // For superAdmin without client selection, get all events
      const schedules = Schedules.find().fetch();
      events = schedules.reduce((acc, schedule) => {
        if (schedule.events && Array.isArray(schedule.events)) {
          return acc.concat(schedule.events);
        }
        return acc;
      }, []);
    } else {
      // For specific client or non-superAdmin
      const targetUserId = selectedUserId || user._id;
      const schedules = Schedules.find({ userId: targetUserId }).fetch();
      events = schedules.reduce((acc, schedule) => {
        if (schedule.events && Array.isArray(schedule.events)) {
          return acc.concat(schedule.events);
        }
        return acc;
      }, []);
    }

    const sortedEvents = events
      .filter(event => event.date)
      .sort((a, b) => moment(a.date) - moment(b.date));

    const nextObservation = sortedEvents.find(event => 
      moment(event.date).isAfter(moment(), 'day')
    );

    return sortedEvents.map(event => ({
      ...event,
      isNextObservation: nextObservation && event.date === nextObservation.date
    }));
  },

  eventRowClass() {
    if (!this.date) return '';
    if (moment(this.date).isBefore(moment(), 'day')) {
      return 'text-muted';
    }
    if (this.isNextObservation) {
      return 'text-warning font-weight-bold';
    }
    return 'text-white';
  },

  capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
  },

  formatDate(date) {
    if (!date) return '';
    // Parse string date to moment object
    return moment(date, 'YYYY-MM-DD').format('DD.MM.YYYY');
  },

  daysLeft() {
    if (!this.date) return '';
    return moment(this.date, 'YYYY-MM-DD').diff(moment(), 'days');
  },

  isPastEvent() {
    if (!this.date) return false;
    return moment(this.date, 'YYYY-MM-DD').isBefore(moment(), 'day');
  }
});

Template.home.onRendered(function() {
  let bubbleChart;
  let issuerChart;
  const template = this;

  // First autorun for risk bubble chart
  this.autorun(() => {
    const riskData = Risk.find().fetch();
    if (!riskData || !riskData.length) return;

    Tracker.afterFlush(() => {
      if (bubbleChart) {
        bubbleChart.destroy();
      }
      bubbleChart = renderBubbleChart(riskData, 'riskBubbleChart');
    });
  });

  // Second autorun for issuer pie chart
  this.autorun(() => {
    const user = Meteor.user();
    if (!user) return;

    let holdingsQuery = {};
    if (user.profile?.role !== 'superAdmin') {
      holdingsQuery = { userId: user._id };
    }

    const holdings = Holdings.find(holdingsQuery).fetch();
    const issuerTotals = {};
    
    holdings.forEach(holding => {
      const product = Products.findOne({ 'genericData.ISINCode': holding.isin });
      if (product?.genericData?.issuer) {
        // Handle both ID and direct name cases
        let issuerName;
        if (product.genericData.issuer.match(/^[a-zA-Z0-9]{17}$/)) {
          // If issuer looks like an ID, try to get name from Issuers collection
          const issuerDoc = Issuers.findOne(product.genericData.issuer);
          issuerName = issuerDoc?.name || product.genericData.issuer;
        } else {
          // If not an ID, use directly
          issuerName = product.genericData.issuer;
        }
        const nominal = parseInt(product.genericData.nominalAmount) || 0;
        issuerTotals[issuerName] = (issuerTotals[issuerName] || 0) + nominal;
      }
    });

    const issuerData = {
      labels: Object.keys(issuerTotals),
      data: Object.values(issuerTotals)
    };

    if (!issuerData.labels.length) return;

    Tracker.afterFlush(() => {
      const ctx = document.getElementById('issuerPieChart')?.getContext('2d');
      if (!ctx) return;

      if (issuerChart) {
        issuerChart.destroy();
      }

      issuerChart = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: issuerData.labels,
          datasets: [{
            data: issuerData.data,
            backgroundColor: [
              '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD',
              '#D4A5A5', '#9A8194', '#392F5A', '#31A9B8', '#258039'
            ],
            borderWidth: 1,
            borderColor: '#fff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                color: '#fff',
                padding: 10,
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const value = context.raw;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = ((value / total) * 100).toFixed(1);
                  return `${context.label}: ${value.toLocaleString()} (${percentage}%)`;
                }
              }
            }
          }
        }
      });
    });
  });

  // Add auto-scroll to next observation
  this.autorun(() => {
    const schedules = Schedules.find().fetch();
    if (!schedules || !schedules.length) return;

    Tracker.afterFlush(() => {
      const nextObservationRow = document.querySelector('tr.text-warning.fw-bold');
      if (nextObservationRow) {
        const container = document.getElementById('scheduleTableContainer');
        if (container) {
          container.scrollTo({
            top: nextObservationRow.offsetTop - container.offsetTop - 50,
            behavior: 'smooth'
          });
        }
      }
    });
  });
});

Template.home.onDestroyed(function() {
  if (this.bubbleChart) {
    this.bubbleChart.destroy();
  }
  if (this.issuerChart) {
    this.issuerChart.destroy();
  }
});

// Add missing helpers for comparisons
Template.registerHelper('lt', function(a, b) {
  return a < b;
});

Template.registerHelper('eq', function(a, b) {
  return a === b;
});

Template.registerHelper('formatPercentage', function(value) {
  if (!value && value !== 0) return '-';
  return value.toFixed(2);
});

Template.registerHelper('now', function() {
  return new Date();
});



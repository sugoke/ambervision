import { Template } from 'meteor/templating';
import { Products, Holdings, Risk, Schedules } from '/imports/api/products/products.js';
import moment from 'moment';
import '../html/home.html';
import { renderBubbleChart } from './modular/bubbleChartHome.js';
import '../css/home.css';
import { HTTP } from 'meteor/http';
import { ReactiveVar } from 'meteor/reactive-var';

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
  
  // Add news state
  this.newsLoading = new ReactiveVar(true);
  this.newsItems = new ReactiveVar([]);
  
  // Fetch news when template is created
  this.autorun(() => {
    const riskData = Risk.find().fetch();
    if (riskData.length) {
      this.loadNews(riskData);
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
  },

  newsItems() {
    return Template.instance().newsItems.get();
  },
  
  newsLoading() {
    return Template.instance().newsLoading.get();
  }
});

Template.home.onRendered(function() {
  this.autorun(() => {
    const riskData = Risk.find().fetch();
    if (!riskData || !riskData.length) return;

    // Wait for DOM to be ready
    Tracker.afterFlush(() => {
      renderBubbleChart(riskData, 'riskBubbleChart');
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
  if (this.chart) {
    this.chart.destroy();
  }
});

Template.home.prototype.loadNews = async function(riskData) {
  this.newsLoading.set(true);
  try {
    const tickers = [...new Set(riskData.map(r => r.underlyingEodticker))].filter(Boolean);
    
    if (tickers.length > 0) {
      const news = await Meteor.callAsync('getEodNews', tickers);
      this.newsItems.set(news);
    } else {
      this.newsItems.set([]);
    }
  } catch (error) {
    console.error('Error loading news:', error);
    this.newsItems.set([]);
  } finally {
    this.newsLoading.set(false);
  }
};



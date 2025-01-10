import { ReactiveVar } from 'meteor/reactive-var';

Template.phoenix.onCreated(function() {
  this.newsLoading = new ReactiveVar(true);
  this.newsItems = new ReactiveVar([]);

  this.autorun(() => {
    const product = Template.currentData();
    if (product?.underlyings) {
      this.loadNews(product.underlyings);
    }
  });
});

Template.phoenix.helpers({
  newsItems() {
    return Template.instance().newsItems.get();
  },
  
  newsLoading() {
    return Template.instance().newsLoading.get();
  }
});

Template.phoenix.prototype.loadNews = async function(underlyings) {
  this.newsLoading.set(true);
  try {
    const tickers = underlyings
      .map(u => u.eodTicker)
      .filter(Boolean);
      
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
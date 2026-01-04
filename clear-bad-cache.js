// Run this in the browser console to clear bad cache entries and force re-fetch
Meteor.call('tickerCache.clearInvalidPrices', (error, result) => {
  if (error) {
    console.error('Error clearing invalid cache:', error);
  } else {
    console.log('✅ Cleared invalid cache entries:', result);
    // Force refresh the page to re-fetch
    window.location.reload();
  }
});

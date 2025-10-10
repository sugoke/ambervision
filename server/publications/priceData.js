// Price Data Publications
// Handles all price-related publications

import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { ProductPricesCollection } from '/imports/api/productPrices';

// Publish recent price uploads (superadmin only)
Meteor.publish("recentPriceUploads", async function (limit = 10) {
  const user = await UsersCollection.findOneAsync(this.userId);
  if (!user || user.role !== USER_ROLES.SUPERADMIN) {
    return this.ready();
  }
  return ProductPricesCollection.find(
    { isActive: true },
    { sort: { uploadDate: -1 }, limit: Math.min(limit, 100) }
  );
});

// Publish price history for specific ISIN
Meteor.publish("priceHistory", function (isin, limit = 50) {
  if (!isin) return this.ready();
  return ProductPricesCollection.find(
    { isin: isin.toUpperCase(), isActive: true },
    { sort: { priceDate: -1, uploadDate: -1 }, limit: Math.min(limit, 200) }
  );
});







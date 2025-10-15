import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const ProductsCollection = new Mongo.Collection('products');

if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Set or unset issuer call for a participation note
     * Admin/SuperAdmin only
     */
    async 'products.setIssuerCall'(productId, issuerCallData) {
      // Check authentication
      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in');
      }

      // Get user
      const user = await Meteor.users.findOneAsync(this.userId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'User not found');
      }

      // Check if user is admin or superadmin
      if (user.role !== 'admin' && user.role !== 'superadmin') {
        throw new Meteor.Error('not-authorized', 'Only admins and superadmins can set issuer call');
      }

      // Validate product exists
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        throw new Meteor.Error('not-found', 'Product not found');
      }

      // Validate it's a participation note
      if (product.templateId !== 'participation_note') {
        throw new Meteor.Error('invalid-product', 'Only participation notes can have issuer calls set');
      }

      // Update product with issuer call data
      const updateFields = {};

      if (issuerCallData.hasCallOption) {
        // Set issuer call
        updateFields['structureParameters.issuerCallDate'] = issuerCallData.callDate;

        // Handle call price
        if (issuerCallData.callPrice) {
          updateFields['structureParameters.issuerCallPrice'] = parseFloat(issuerCallData.callPrice);
        } else {
          // Remove call price if not provided
          await ProductsCollection.updateAsync(productId, {
            $unset: { 'structureParameters.issuerCallPrice': '' }
          });
        }

        // Handle call rebate
        if (issuerCallData.callRebate) {
          updateFields['structureParameters.issuerCallRebate'] = parseFloat(issuerCallData.callRebate);
        } else {
          // Remove call rebate if not provided
          await ProductsCollection.updateAsync(productId, {
            $unset: { 'structureParameters.issuerCallRebate': '' }
          });
        }
      } else {
        // Remove issuer call
        await ProductsCollection.updateAsync(productId, {
          $unset: {
            'structureParameters.issuerCallDate': '',
            'structureParameters.issuerCallPrice': '',
            'structureParameters.issuerCallRebate': ''
          }
        });

        console.log(`🏦 Issuer call removed from product ${productId} by ${user.email}`);
        return { success: true, removed: true };
      }

      // Perform the update
      const result = await ProductsCollection.updateAsync(productId, {
        $set: updateFields
      });

      console.log(`🏦 Issuer call set for product ${productId} by ${user.email}:`, issuerCallData);

      return { success: true, updated: result };
    }
  });
}
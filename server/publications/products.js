// Products Publications
// Handles all product-related publications with role-based access control

import { check } from 'meteor/check';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';

// Role-based products publication with access control
Meteor.publish("products", async function (sessionId = null, viewAsFilter = null) {
  // Use provided sessionId parameter or fallback to connection ID
  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  // Try to get user from session (if available)
  if (effectiveSessionId) {
    try {
      const session = await SessionHelpers.validateSession(effectiveSessionId);

      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
      }
    } catch (error) {
      // Session validation failed - continue with no user
    }
  }

  // If no authenticated user, return empty (security)
  if (!currentUser) {
    return this.ready();
  }

  // Handle View As filter for admins
  if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
    console.log(`[PRODUCTS] Admin ${currentUser.email} viewing as:`, viewAsFilter);

    // Determine the client ID to filter by
    let targetClientId = null;

    if (viewAsFilter.type === 'client') {
      targetClientId = viewAsFilter.id;
    } else if (viewAsFilter.type === 'account') {
      // Find the user associated with this bank account
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (bankAccount) {
        targetClientId = bankAccount.userId;
      }
    }

    if (targetClientId) {
      // Find allocations for this specific client
      const allocations = await AllocationsCollection.find({
        clientId: targetClientId
      }).fetchAsync();

      const productIds = [...new Set(allocations.map(alloc => alloc.productId))];

      console.log(`[PRODUCTS] Filtering to ${productIds.length} products for client ${targetClientId}`);

      if (productIds.length === 0) {
        return this.ready();
      }

      return ProductsCollection.find({ _id: { $in: productIds } });
    } else {
      // ViewAs filter is active but couldn't determine target client - return empty
      console.log(`[PRODUCTS] ViewAs filter active but no valid target client found - returning empty`);
      return this.ready();
    }
  }

  // SuperAdmin sees everything (when not using View As)
  if (currentUser.role === USER_ROLES.SUPERADMIN) {
    console.log(`[PRODUCTS] SuperAdmin ${currentUser.email} accessing products`);
    return ProductsCollection.find();
  }

  // Admin sees everything (same as superadmin for now, when not using View As)
  if (currentUser.role === USER_ROLES.ADMIN) {
    console.log(`[PRODUCTS] Admin ${currentUser.email} accessing products`);
    return ProductsCollection.find();
  }

  // Compliance sees everything (for compliance review purposes)
  if (currentUser.role === USER_ROLES.COMPLIANCE) {
    console.log(`[PRODUCTS] Compliance ${currentUser.email} accessing products`);
    return ProductsCollection.find();
  }

  // Relationship Manager sees products of their assigned clients
  if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
    // Get all clients assigned to this RM
    const assignedClients = await UsersCollection.find({
      role: USER_ROLES.CLIENT,
      relationshipManagerId: currentUser._id
    }).fetchAsync();

    const clientIds = assignedClients.map(client => client._id);

    if (clientIds.length === 0) {
      return this.ready();
    }

    // Find all allocations for these clients
    const clientAllocations = await AllocationsCollection.find({
      clientId: { $in: clientIds }
    }).fetchAsync();

    const productIds = [...new Set(clientAllocations.map(alloc => alloc.productId))];

    return ProductsCollection.find({ _id: { $in: productIds } });
  }

  // Client sees only products they have allocations in
  if (currentUser.role === USER_ROLES.CLIENT) {
    // Find all allocations for this client (active, matured, or cancelled)
    const userAllocations = await AllocationsCollection.find({
      clientId: currentUser._id
    }).fetchAsync();

    const productIds = [...new Set(userAllocations.map(alloc => alloc.productId))];

    if (productIds.length === 0) {
      return this.ready();
    }

    return ProductsCollection.find({ _id: { $in: productIds } });
  }

  // Unknown role - return empty
  return this.ready();
});

// Publish single product by ID
Meteor.publish("products.single", async function (productId, sessionId = null) {
  check(productId, String);

  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  if (effectiveSessionId) {
    try {
      // Check if this is a PDF temporary session
      if (effectiveSessionId.startsWith('pdf-temp-')) {
        const pdfToken = effectiveSessionId.replace('pdf-temp-', '');
        // Find user with this PDF token
        const userWithToken = await UsersCollection.findOneAsync({
          'services.pdfAccess.token': pdfToken
        });
        if (userWithToken) {
          const expiresAt = userWithToken.services?.pdfAccess?.expiresAt;
          if (!expiresAt || new Date(expiresAt) >= new Date()) {
            currentUser = userWithToken;
            console.log('[products.single] PDF auth successful for user:', currentUser._id);
          }
        }
      } else {
        // Normal session validation
        const session = await SessionHelpers.validateSession(effectiveSessionId);
        if (session && session.userId) {
          currentUser = await UsersCollection.findOneAsync(session.userId);
        }
      }
    } catch (error) {
      // Session validation failed
      console.error('[products.single] Session validation error:', error.message);
    }
  }

  // If no authenticated user, return empty
  if (!currentUser) {
    console.log('[products.single] No authenticated user, returning empty');
    return this.ready();
  }

  // Find the specific product
  const product = await ProductsCollection.findOneAsync(productId);
  if (!product) {
    return this.ready();
  }

  // Apply same access control as products publication
  if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.COMPLIANCE) {
    return ProductsCollection.find({ _id: productId });
  }

  // For clients and RMs, check if they have access to this product through allocations
  let hasAccess = false;

  if (currentUser.role === USER_ROLES.CLIENT) {
    const allocation = await AllocationsCollection.findOneAsync({
      productId: productId,
      clientId: currentUser._id
    });
    hasAccess = !!allocation;
  } else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
    const assignedClients = await UsersCollection.find({
      role: USER_ROLES.CLIENT,
      relationshipManagerId: currentUser._id
    }).fetchAsync();

    const clientIds = assignedClients.map(client => client._id);
    const allocation = await AllocationsCollection.findOneAsync({
      productId: productId,
      clientId: { $in: clientIds }
    });
    hasAccess = !!allocation;
  }

  if (hasAccess) {
    return ProductsCollection.find({ _id: productId });
  }

  return this.ready();
});

// Publish product allocations with role-based access control
Meteor.publish("productAllocations", async function (productId, sessionId = null) {
  check(productId, String);

  // Get the current user making the subscription request
  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  // Try to get user from session
  if (effectiveSessionId) {
    try {
      const session = await SessionHelpers.validateSession(effectiveSessionId);
      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
      }
    } catch (error) {
      // console.log('productAllocations publication: No valid session found');
    }
  }

  // If no authenticated user, return empty
  if (!currentUser) {
    // console.log('productAllocations publication: No authenticated user, returning empty');
    return this.ready();
  }

  // console.log('productAllocations publication: User role:', currentUser.role, 'productId:', productId);

  try {
    // SuperAdmin and Admin see all allocations for the product
    if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN) {
      // console.log('productAllocations publication: Admin/SuperAdmin access - returning all allocations');
      return AllocationsCollection.find({ productId: productId });
    }

    // Relationship Manager sees allocations for their assigned clients only
    if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      // console.log('productAllocations publication: RM access - finding client allocations');

      // Get all clients assigned to this RM
      const assignedClients = await UsersCollection.find({
        role: USER_ROLES.CLIENT,
        relationshipManagerId: currentUser._id
      }).fetchAsync();

      const clientIds = assignedClients.map(client => client._id);
      // console.log('productAllocations publication: RM has', clientIds.length, 'assigned clients');

      if (clientIds.length === 0) {
        return this.ready();
      }

      return AllocationsCollection.find({
        productId: productId,
        clientId: { $in: clientIds }
      });
    }

    // Client sees only their own allocations
    if (currentUser.role === USER_ROLES.CLIENT) {
      // console.log('productAllocations publication: Client access - returning own allocations');
      return AllocationsCollection.find({
        productId: productId,
        clientId: currentUser._id
      });
    }

    // Unknown role - return empty
    // console.log('productAllocations publication: Unknown role:', currentUser.role);
    return this.ready();
  } catch (error) {
    console.log('productAllocations publication error:', error.message);
    return this.ready();
  }
});

// Publish all allocations with role-based access control
Meteor.publish("allAllocations", async function (sessionId = null, viewAsFilter = null) {
  // Get the current user making the subscription request
  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  // Try to get user from session
  if (effectiveSessionId) {
    try {
      const session = await SessionHelpers.validateSession(effectiveSessionId);
      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
      }
    } catch (error) {
      // console.log('allAllocations publication: Session validation error:', error.message);
    }
  }

  // If no authenticated user, return empty
  if (!currentUser) {
    // console.log('allAllocations publication: No authenticated user, returning empty');
    return this.ready();
  }

  try {
    // Handle View As filter for admins
    if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
      console.log(`[ALLOCATIONS] Admin ${currentUser.email} viewing as:`, viewAsFilter);

      // Determine the client ID to filter by
      let targetClientId = null;

      if (viewAsFilter.type === 'client') {
        targetClientId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        // Find the user associated with this bank account
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          targetClientId = bankAccount.userId;
        }
      }

      if (targetClientId) {
        console.log(`[ALLOCATIONS] Filtering to allocations for client ${targetClientId}`);
        return AllocationsCollection.find({ clientId: targetClientId });
      } else {
        // ViewAs filter is active but couldn't determine target client - return empty
        console.log(`[ALLOCATIONS] ViewAs filter active but no valid target client found - returning empty`);
        return this.ready();
      }
    }

    // SuperAdmin and Admin see all allocations (when not using View As)
    if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN) {
      return AllocationsCollection.find();
    }

    // Relationship Manager sees allocations for their assigned clients only
    if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      const assignedClients = await UsersCollection.find({
        role: USER_ROLES.CLIENT,
        relationshipManagerId: currentUser._id
      }).fetchAsync();

      const clientIds = assignedClients.map(client => client._id);
      if (clientIds.length === 0) {
        return this.ready();
      }

      return AllocationsCollection.find({ clientId: { $in: clientIds } });
    }

    // Client sees only their own allocations
    if (currentUser.role === USER_ROLES.CLIENT) {
      return AllocationsCollection.find({ clientId: currentUser._id });
    }

    return this.ready();
  } catch (error) {
    console.log('allAllocations publication error:', error.message);
    return this.ready();
  }
});








// Special publication for RMs to see all products (when "Show All" toggle is ON)
Meteor.publish("products.all", async function (sessionId = null) {
  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  // Try to get user from session
  if (effectiveSessionId) {
    try {
      const session = await SessionHelpers.validateSession(effectiveSessionId);
      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
      }
    } catch (error) {
      // Session validation failed
    }
  }

  // Only allow RMs, admins, superadmins, and compliance to access all products
  if (!currentUser || (currentUser.role !== USER_ROLES.RELATIONSHIP_MANAGER &&
                       currentUser.role !== USER_ROLES.ADMIN &&
                       currentUser.role !== USER_ROLES.SUPERADMIN &&
                       currentUser.role !== USER_ROLES.COMPLIANCE)) {
    return this.ready();
  }

  console.log(`[PRODUCTS.ALL] ${currentUser.role} ${currentUser.email} viewing all products`);

  // Return all products without any filtering
  return ProductsCollection.find();
});

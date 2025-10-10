// Products Publications
// Handles all product-related publications with role-based access control

import { check } from 'meteor/check';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';

// Role-based products publication with access control
Meteor.publish("products", async function (sessionId = null) {
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

  // SuperAdmin sees everything
  if (currentUser.role === USER_ROLES.SUPERADMIN) {
    console.log(`[PRODUCTS] SuperAdmin ${currentUser.email} accessing products`);
    return ProductsCollection.find();
  }

  // Admin sees everything (same as superadmin for now)
  if (currentUser.role === USER_ROLES.ADMIN) {
    console.log(`[PRODUCTS] Admin ${currentUser.email} accessing products`);
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
      const session = await SessionHelpers.validateSession(effectiveSessionId);
      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
      }
    } catch (error) {
      // Session validation failed
    }
  }

  // If no authenticated user, return empty
  if (!currentUser) {
    return this.ready();
  }

  // Find the specific product
  const product = await ProductsCollection.findOneAsync(productId);
  if (!product) {
    return this.ready();
  }

  // Apply same access control as products publication
  if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN) {
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
Meteor.publish("allAllocations", async function (sessionId = null) {
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
    // SuperAdmin and Admin see all allocations
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







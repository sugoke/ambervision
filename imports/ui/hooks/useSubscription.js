import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { useState, useEffect } from 'react';

/**
 * Enhanced subscription hook with loading state and error handling
 * 
 * @param {string} subscriptionName - Meteor subscription name
 * @param {Array} params - Subscription parameters
 * @param {Object} options - Additional options
 * @param {boolean} options.skip - Skip subscription
 * @param {Function} options.onError - Error callback
 * @param {Function} options.onReady - Ready callback
 * @returns {Object} { loading, error, ready }
 */
export const useSubscription = (subscriptionName, params = [], options = {}) => {
  const [error, setError] = useState(null);
  const { skip = false, onError, onReady } = options;

  const loading = useSubscribe(subscriptionName, ...(skip ? [] : params), {
    onError: (err) => {
      console.error(`Subscription error for ${subscriptionName}:`, err);
      setError(err);
      onError?.(err);
    },
    onReady: () => {
      setError(null);
      onReady?.();
    }
  });

  const ready = !loading() && !error;

  useEffect(() => {
    if (skip) {
      setError(null);
    }
  }, [skip]);

  return { loading: loading(), error, ready };
};

/**
 * Subscription hook with collection data
 * 
 * @param {Object} collection - Meteor collection
 * @param {string} subscriptionName - Subscription name
 * @param {Function|Object} selector - MongoDB selector or function returning selector
 * @param {Object} options - Query options and subscription options
 * @returns {Object} { data, loading, error, ready }
 */
export const useCollectionData = (collection, subscriptionName, selector = {}, options = {}) => {
  const { subscriptionParams = [], queryOptions = {}, ...subscriptionOptions } = options;
  
  const { loading, error, ready } = useSubscription(subscriptionName, subscriptionParams, subscriptionOptions);

  const data = useTracker(() => {
    if (!ready) return [];
    
    const query = typeof selector === 'function' ? selector() : selector;
    return collection.find(query, queryOptions).fetch();
  }, [ready, selector, queryOptions]);

  return { data, loading, error, ready };
};

/**
 * Single document subscription hook
 * 
 * @param {Object} collection - Meteor collection
 * @param {string} subscriptionName - Subscription name
 * @param {string|Function} docId - Document ID or function returning ID
 * @param {Object} options - Subscription options
 * @returns {Object} { document, loading, error, ready }
 */
export const useDocument = (collection, subscriptionName, docId, options = {}) => {
  const { subscriptionParams = [], ...subscriptionOptions } = options;
  
  const params = typeof docId === 'function' ? [docId(), ...subscriptionParams] : [docId, ...subscriptionParams];
  const { loading, error, ready } = useSubscription(subscriptionName, params, subscriptionOptions);

  const document = useTracker(() => {
    if (!ready) return null;
    
    const id = typeof docId === 'function' ? docId() : docId;
    return id ? collection.findOne(id) : null;
  }, [ready, docId]);

  return { document, loading, error, ready };
};
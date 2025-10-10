import { useState, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * Hook for handling Meteor method calls with loading states and error handling
 * 
 * @param {string} methodName - Meteor method name
 * @param {Object} options - Configuration options
 * @param {Function} options.onSuccess - Success callback
 * @param {Function} options.onError - Error callback
 * @param {boolean} options.throwOnError - Whether to throw errors instead of catching them
 * @returns {Object} { call, loading, error, result, reset }
 */
export const useMeteorCall = (methodName, options = {}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const { onSuccess, onError, throwOnError = false } = options;

  const call = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await new Promise((resolve, reject) => {
        Meteor.call(methodName, ...args, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });

      setResult(response);
      onSuccess?.(response);
      return response;
    } catch (err) {
      console.error(`Meteor method error (${methodName}):`, err);
      setError(err);
      onError?.(err);
      
      if (throwOnError) {
        throw err;
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [methodName, onSuccess, onError, throwOnError]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return { call, loading, error, result, reset };
};

/**
 * Hook for immediate Meteor method calls (calls method on mount)
 * 
 * @param {string} methodName - Meteor method name
 * @param {Array} args - Method arguments
 * @param {Object} options - Configuration options
 * @param {boolean} options.skip - Skip the call
 * @param {Array} options.deps - Dependencies for re-calling
 * @returns {Object} { data, loading, error, refetch }
 */
export const useMeteorData = (methodName, args = [], options = {}) => {
  const [data, setData] = useState(null);
  const { skip = false, deps = [], ...callOptions } = options;

  const { call, loading, error, reset } = useMeteorCall(methodName, {
    ...callOptions,
    onSuccess: (result) => {
      setData(result);
      callOptions.onSuccess?.(result);
    }
  });

  const refetch = useCallback(() => {
    reset();
    if (!skip) {
      call(...args);
    }
  }, [call, reset, skip, ...args, ...deps]);

  // Initial call
  React.useEffect(() => {
    if (!skip) {
      call(...args);
    }
  }, [skip, ...deps]);

  return { data, loading, error, refetch };
};

/**
 * Hook for optimistic Meteor method calls with rollback capability
 * 
 * @param {string} methodName - Meteor method name
 * @param {Object} options - Configuration options
 * @param {Function} options.optimisticUpdate - Function to apply optimistic update
 * @param {Function} options.rollback - Function to rollback on error
 * @returns {Object} { call, loading, error }
 */
export const useOptimisticCall = (methodName, options = {}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { optimisticUpdate, rollback, onSuccess, onError } = options;

  const call = useCallback(async (...args) => {
    setLoading(true);
    setError(null);

    // Apply optimistic update
    optimisticUpdate?.(...args);

    try {
      const result = await new Promise((resolve, reject) => {
        Meteor.call(methodName, ...args, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });

      onSuccess?.(result);
      return result;
    } catch (err) {
      console.error(`Optimistic call error (${methodName}):`, err);
      setError(err);
      
      // Rollback optimistic update
      rollback?.(...args);
      onError?.(err);
      
      throw err;
    } finally {
      setLoading(false);
    }
  }, [methodName, optimisticUpdate, rollback, onSuccess, onError]);

  return { call, loading, error };
};
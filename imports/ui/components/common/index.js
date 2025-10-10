/**
 * Common UI Components Index
 * Centralized exports for all reusable UI components
 */

// Basic components
export { default as LoadingSpinner } from './LoadingSpinner.jsx';
export { default as ActionButton } from './ActionButton.jsx';
export { default as Card } from './Card.jsx';
export { default as FormField } from './FormField.jsx';
export { default as DataTable } from './DataTable.jsx';
export { default as Modal } from './Modal.jsx';

// Re-export hooks for convenience
export { useSubscription, useCollectionData, useDocument } from '../../hooks/useSubscription.js';
export { useMeteorCall, useMeteorData, useOptimisticCall } from '../../hooks/useMeteorCall.js';
export { useForm } from '../../hooks/useForm.js';

// Re-export utilities
export * from '../../../utils/errorHandling.js';
export * from '../../../utils/formatters.js';
export * from '../../../constants/styles.js';
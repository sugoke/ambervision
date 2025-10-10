/**
 * UI Component Types
 * 
 * Re-exports the canonical ItemTypes from the API layer to ensure
 * consistency between UI and backend components.
 * 
 * IMPORTANT: Always use these constants instead of string literals
 * when referencing component types in the UI.
 */

// Re-export all ItemTypes from the canonical source
export { ItemTypes, isValidComponentType, getComponentTypeKey } from '../../../api/componentTypes.js';
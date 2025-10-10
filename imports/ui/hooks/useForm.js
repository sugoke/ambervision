import { useState, useCallback } from 'react';

/**
 * Form management hook with validation and error handling
 * 
 * @param {Object} initialValues - Initial form values
 * @param {Object} options - Configuration options
 * @param {Object} options.validationSchema - Validation rules
 * @param {Function} options.onSubmit - Submit handler
 * @param {boolean} options.validateOnChange - Validate on field change
 * @param {boolean} options.validateOnBlur - Validate on field blur
 * @returns {Object} Form management object
 */
export const useForm = (initialValues = {}, options = {}) => {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { 
    validationSchema = {}, 
    onSubmit, 
    validateOnChange = true, 
    validateOnBlur = true 
  } = options;

  // Validation function
  const validate = useCallback((valuesToValidate = values, fieldsToValidate = Object.keys(validationSchema)) => {
    const newErrors = {};

    fieldsToValidate.forEach(field => {
      const rules = validationSchema[field];
      if (!rules) return;

      const value = valuesToValidate[field];
      
      // Required validation
      if (rules.required && (!value || (typeof value === 'string' && !value.trim()))) {
        newErrors[field] = rules.requiredMessage || `${field} is required`;
        return;
      }

      // Skip other validations if field is empty and not required
      if (!value && !rules.required) return;

      // Type validation
      if (rules.type) {
        switch (rules.type) {
          case 'email':
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              newErrors[field] = rules.typeMessage || 'Invalid email format';
            }
            break;
          case 'number':
            if (isNaN(value) || isNaN(parseFloat(value))) {
              newErrors[field] = rules.typeMessage || 'Must be a valid number';
            }
            break;
        }
      }

      // Length validation
      if (rules.minLength && String(value).length < rules.minLength) {
        newErrors[field] = rules.minLengthMessage || `Minimum ${rules.minLength} characters required`;
      }

      if (rules.maxLength && String(value).length > rules.maxLength) {
        newErrors[field] = rules.maxLengthMessage || `Maximum ${rules.maxLength} characters allowed`;
      }

      // Value validation
      if (rules.min && Number(value) < rules.min) {
        newErrors[field] = rules.minMessage || `Minimum value is ${rules.min}`;
      }

      if (rules.max && Number(value) > rules.max) {
        newErrors[field] = rules.maxMessage || `Maximum value is ${rules.max}`;
      }

      // Pattern validation
      if (rules.pattern && !rules.pattern.test(value)) {
        newErrors[field] = rules.patternMessage || 'Invalid format';
      }

      // Custom validation
      if (rules.validate && typeof rules.validate === 'function') {
        const customError = rules.validate(value, valuesToValidate);
        if (customError) {
          newErrors[field] = customError;
        }
      }
    });

    return newErrors;
  }, [values, validationSchema]);

  // Field change handler
  const handleChange = useCallback((field, value) => {
    const newValues = { ...values, [field]: value };
    setValues(newValues);

    if (validateOnChange && touched[field]) {
      const fieldErrors = validate(newValues, [field]);
      setErrors(prev => ({
        ...prev,
        [field]: fieldErrors[field] || null
      }));
    }
  }, [values, touched, validateOnChange, validate]);

  // Field blur handler
  const handleBlur = useCallback((field) => {
    setTouched(prev => ({ ...prev, [field]: true }));

    if (validateOnBlur) {
      const fieldErrors = validate(values, [field]);
      setErrors(prev => ({
        ...prev,
        [field]: fieldErrors[field] || null
      }));
    }
  }, [values, validateOnBlur, validate]);

  // Form submission handler
  const handleSubmit = useCallback(async (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }

    // Mark all fields as touched
    const allFieldsTouched = Object.keys(validationSchema).reduce((acc, field) => {
      acc[field] = true;
      return acc;
    }, {});
    setTouched(allFieldsTouched);

    // Validate all fields
    const formErrors = validate();
    setErrors(formErrors);

    // Check if form is valid
    const isValid = Object.keys(formErrors).length === 0;
    if (!isValid) {
      return false;
    }

    // Submit form
    if (onSubmit) {
      setIsSubmitting(true);
      try {
        await onSubmit(values);
        return true;
      } catch (error) {
        console.error('Form submission error:', error);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    }

    return true;
  }, [values, validationSchema, validate, onSubmit]);

  // Reset form
  const reset = useCallback((newValues = initialValues) => {
    setValues(newValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
  }, [initialValues]);

  // Set field error manually
  const setFieldError = useCallback((field, error) => {
    setErrors(prev => ({ ...prev, [field]: error }));
  }, []);

  // Set field value manually
  const setFieldValue = useCallback((field, value) => {
    setValues(prev => ({ ...prev, [field]: value }));
  }, []);

  // Check if form is valid
  const isValid = Object.keys(errors).every(field => !errors[field]);

  // Get field props for easy integration with form components
  const getFieldProps = useCallback((field) => ({
    value: values[field] || '',
    onChange: (e) => {
      const value = e.target ? e.target.value : e;
      handleChange(field, value);
    },
    onBlur: () => handleBlur(field),
    error: touched[field] ? errors[field] : null
  }), [values, errors, touched, handleChange, handleBlur]);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    isValid,
    handleChange,
    handleBlur,
    handleSubmit,
    reset,
    setFieldError,
    setFieldValue,
    getFieldProps,
    validate
  };
};
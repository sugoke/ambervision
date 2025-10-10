import { useState } from 'react';

export const useDialog = () => {
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
    onConfirm: null,
    onCancel: null,
    confirmText: 'OK',
    cancelText: 'Cancel',
    showCancel: false,
    children: null
  });

  const showDialog = (options) => {
    setDialogState({
      isOpen: true,
      title: options.title || '',
      message: options.message || '',
      type: options.type || 'info',
      onConfirm: options.onConfirm || null,
      onCancel: options.onCancel || null,
      confirmText: options.confirmText || 'OK',
      cancelText: options.cancelText || 'Cancel',
      showCancel: options.showCancel || false,
      children: options.children || null
    });
  };

  const hideDialog = () => {
    setDialogState(prev => ({ ...prev, isOpen: false }));
  };

  // Convenience methods for different dialog types
  const showAlert = (message, title = 'Alert') => {
    showDialog({
      title,
      message,
      type: 'info',
      showCancel: false
    });
  };

  const showError = (message, title = 'Error') => {
    showDialog({
      title,
      message,
      type: 'error',
      showCancel: false
    });
  };

  const showSuccess = (message, title = 'Success') => {
    showDialog({
      title,
      message,
      type: 'success',
      showCancel: false
    });
  };

  const showWarning = (message, title = 'Warning') => {
    showDialog({
      title,
      message,
      type: 'warning',
      showCancel: false
    });
  };

  const showConfirm = (message, onConfirm, title = 'Confirm') => {
    return new Promise((resolve) => {
      showDialog({
        title,
        message,
        type: 'confirm',
        showCancel: true,
        onConfirm: () => {
          resolve(true);
          if (onConfirm) onConfirm();
        },
        onCancel: () => {
          resolve(false);
        },
        confirmText: 'Yes',
        cancelText: 'No'
      });
    });
  };

  return {
    dialogState,
    showDialog,
    hideDialog,
    showAlert,
    showError,
    showSuccess,
    showWarning,
    showConfirm
  };
};
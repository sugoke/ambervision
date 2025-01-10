// In your client/main.js

import { Meteor } from 'meteor/meteor';
import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

// Ensure Bootstrap is available globally
if (typeof window !== 'undefined') {
  window.bootstrap = require('bootstrap/dist/js/bootstrap.bundle.min.js');
}

Meteor.startup(() => {
  // Initialize Bootstrap components
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
  const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new window.bootstrap.Tooltip(tooltipTriggerEl))

  const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]')
  const popoverList = [...popoverTriggerList].map(popoverTriggerEl => new window.bootstrap.Popover(popoverTriggerEl))

  // Add any other Bootstrap initializations here

  // Initialize your theme
  if (typeof HUD !== 'undefined' && typeof HUD.init === 'function') {
    HUD.init();
  }
});

/**
 * Global debug logger that captures evaluation steps during normal processing
 */

class DebugLogger {
  constructor() {
    this.steps = [];
    this.isLogging = false;
  }

  startLogging() {
    this.isLogging = true;
    this.steps = [];
  }

  stopLogging() {
    this.isLogging = false;
  }

  addStep(type, description, details = {}) {
    if (!this.isLogging) return;
    
    const step = {
      id: this.steps.length + 1,
      type,
      description,
      timestamp: new Date().toISOString(),
      ...details
    };
    
    this.steps.push(step);
    console.log(`[DEBUG STEP ${step.id}] ${description}`);
    
    return step;
  }

  getSteps() {
    return [...this.steps];
  }

  clearSteps() {
    this.steps = [];
  }
}

// Global instance
export const globalDebugLogger = new DebugLogger();
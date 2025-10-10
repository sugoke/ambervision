/**
 * Standardized Event Structure for Generic Product Reporting
 * 
 * This module defines a universal event-based output format that enables
 * the report generator to handle ANY product type without hardcoding.
 * 
 * The event structure captures all possible product behaviors in a
 * self-describing format that can be interpreted to generate appropriate
 * widgets, tables, and charts dynamically.
 */

/**
 * Base class for all standardized events
 */
export class StandardizedEvent {
  constructor(type, date, data = {}) {
    this.id = this.generateId();
    this.type = type; // Event type identifier
    this.date = date instanceof Date ? date : new Date(date);
    this.status = 'pending'; // 'pending', 'triggered', 'missed', 'paid', 'breached'
    this.data = data; // Event-specific data
    this.metadata = {}; // Additional context
    this.linkedEvents = []; // Related event IDs
    this.calculations = {}; // Calculation breakdown
  }

  generateId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  setStatus(status) {
    this.status = status;
    return this;
  }

  addMetadata(key, value) {
    this.metadata[key] = value;
    return this;
  }

  linkEvent(eventId) {
    this.linkedEvents.push(eventId);
    return this;
  }

  addCalculation(key, value) {
    this.calculations[key] = value;
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      date: this.date.toISOString(),
      status: this.status,
      data: this.data,
      metadata: this.metadata,
      linkedEvents: this.linkedEvents,
      calculations: this.calculations
    };
  }
}

/**
 * Observation event - represents scheduled observation points
 */
export class ObservationEvent extends StandardizedEvent {
  constructor(date, observationNumber) {
    super('observation', date);
    this.data.observationNumber = observationNumber;
    this.data.conditions = []; // Conditions checked at this observation
    this.data.underlyingValues = {}; // Underlying values at observation
  }

  addCondition(type, level, status, details = {}) {
    this.data.conditions.push({
      type, // 'autocall', 'coupon', 'barrier', 'range'
      level,
      status, // 'met', 'not_met', 'pending'
      details
    });
    return this;
  }

  setUnderlyingValue(ticker, value, performance) {
    this.data.underlyingValues[ticker] = {
      value,
      performance,
      timestamp: new Date()
    };
    return this;
  }
}

/**
 * Payment event - represents any payment (coupon, redemption, etc.)
 */
export class PaymentEvent extends StandardizedEvent {
  constructor(date, amount, paymentType) {
    super('payment', date);
    this.data.amount = amount;
    this.data.currency = 'USD'; // Default
    this.data.paymentType = paymentType; // 'coupon', 'redemption', 'autocall', 'memory'
    this.data.accumulated = false;
    this.data.observationLinked = null; // Link to observation that triggered it
  }

  setCurrency(currency) {
    this.data.currency = currency;
    return this;
  }

  setAccumulated(isAccumulated, accumulatedPeriods = 0) {
    this.data.accumulated = isAccumulated;
    this.data.accumulatedPeriods = accumulatedPeriods;
    return this;
  }

  linkToObservation(observationEventId) {
    this.data.observationLinked = observationEventId;
    this.linkEvent(observationEventId);
    return this;
  }
}

/**
 * Barrier event - represents barrier monitoring and breaches
 */
export class BarrierEvent extends StandardizedEvent {
  constructor(date, barrierType, level) {
    super('barrier', date);
    this.data.barrierType = barrierType; // 'autocall', 'protection', 'knock-in', 'knock-out', 'cap', 'floor'
    this.data.level = level;
    this.data.direction = 'above'; // 'above' or 'below'
    this.data.breached = false;
    this.data.distance = null; // Distance from current level
    this.data.underlying = null; // Which underlying (for multi-asset)
  }

  setBreached(breached, breachDate = null) {
    this.data.breached = breached;
    this.data.breachDate = breachDate;
    this.status = breached ? 'breached' : 'active';
    return this;
  }

  setDistance(currentLevel) {
    this.data.distance = ((currentLevel - this.data.level) / this.data.level) * 100;
    return this;
  }

  setDirection(direction) {
    this.data.direction = direction;
    return this;
  }

  setUnderlying(ticker) {
    this.data.underlying = ticker;
    return this;
  }
}

/**
 * Termination event - represents early termination conditions
 */
export class TerminationEvent extends StandardizedEvent {
  constructor(date, terminationType) {
    super('termination', date);
    this.data.terminationType = terminationType; // 'autocall', 'knock-out', 'issuer_call'
    this.data.payoutAmount = null;
    this.data.triggerLevel = null;
    this.data.observationNumber = null;
  }

  setPayout(amount, currency = 'USD') {
    this.data.payoutAmount = amount;
    this.data.payoutCurrency = currency;
    return this;
  }

  setTrigger(level, observationNumber) {
    this.data.triggerLevel = level;
    this.data.observationNumber = observationNumber;
    return this;
  }
}

/**
 * Accrual event - represents range accrual or accumulation
 */
export class AccrualEvent extends StandardizedEvent {
  constructor(date, accrualType) {
    super('accrual', date);
    this.data.accrualType = accrualType; // 'range', 'daily', 'continuous'
    this.data.rangeMin = null;
    this.data.rangeMax = null;
    this.data.accrualRate = null;
    this.data.daysInRange = 0;
    this.data.totalDays = 0;
  }

  setRange(min, max) {
    this.data.rangeMin = min;
    this.data.rangeMax = max;
    return this;
  }

  setAccrualProgress(daysInRange, totalDays) {
    this.data.daysInRange = daysInRange;
    this.data.totalDays = totalDays;
    this.data.accrualPercentage = totalDays > 0 ? (daysInRange / totalDays) * 100 : 0;
    return this;
  }

  setAccrualRate(rate) {
    this.data.accrualRate = rate;
    return this;
  }
}

/**
 * Memory event - represents memory feature activation
 */
export class MemoryEvent extends StandardizedEvent {
  constructor(date, memoryType) {
    super('memory', date);
    this.data.memoryType = memoryType; // 'coupon', 'autocall', 'phoenix'
    this.data.storedPeriods = 0;
    this.data.triggerCondition = null;
    this.data.payoutMultiplier = 1;
  }

  setStoredPeriods(periods) {
    this.data.storedPeriods = periods;
    return this;
  }

  setTriggerCondition(condition) {
    this.data.triggerCondition = condition;
    return this;
  }

  setPayoutMultiplier(multiplier) {
    this.data.payoutMultiplier = multiplier;
    return this;
  }
}

/**
 * Event collection that manages all events for a product
 */
export class EventTimeline {
  constructor() {
    this.events = [];
    this.eventsByType = {};
    this.eventsByDate = {};
  }

  addEvent(event) {
    this.events.push(event);
    
    // Index by type
    if (!this.eventsByType[event.type]) {
      this.eventsByType[event.type] = [];
    }
    this.eventsByType[event.type].push(event);
    
    // Index by date
    const dateKey = event.date.toISOString().split('T')[0];
    if (!this.eventsByDate[dateKey]) {
      this.eventsByDate[dateKey] = [];
    }
    this.eventsByDate[dateKey].push(event);
    
    return this;
  }

  getEventsByType(type) {
    return this.eventsByType[type] || [];
  }

  getEventsByDate(date) {
    const dateKey = date instanceof Date ? 
      date.toISOString().split('T')[0] : date;
    return this.eventsByDate[dateKey] || [];
  }

  getEventById(id) {
    return this.events.find(e => e.id === id);
  }

  getAllEvents() {
    return this.events.sort((a, b) => a.date - b.date);
  }

  getTriggeredEvents() {
    return this.events.filter(e => e.status === 'triggered');
  }

  getPendingEvents() {
    return this.events.filter(e => e.status === 'pending');
  }

  /**
   * Generate a schedule table structure from events
   */
  generateScheduleStructure() {
    const observations = this.getEventsByType('observation');
    const payments = this.getEventsByType('payment');
    const barriers = this.getEventsByType('barrier');
    
    const schedule = [];
    
    // Combine all dates
    const allDates = new Set();
    [...observations, ...payments].forEach(e => {
      allDates.add(e.date.toISOString().split('T')[0]);
    });
    
    // Build schedule rows
    Array.from(allDates).sort().forEach(dateStr => {
      const date = new Date(dateStr);
      const dayEvents = this.getEventsByDate(dateStr);
      
      const row = {
        date: date,
        observation: null,
        conditions: [],
        payments: [],
        status: 'pending'
      };
      
      dayEvents.forEach(event => {
        if (event.type === 'observation') {
          row.observation = event.data.observationNumber;
          row.conditions = event.data.conditions;
        } else if (event.type === 'payment') {
          row.payments.push({
            type: event.data.paymentType,
            amount: event.data.amount,
            currency: event.data.currency,
            accumulated: event.data.accumulated
          });
        }
      });
      
      schedule.push(row);
    });
    
    return schedule;
  }

  toJSON() {
    return {
      events: this.events.map(e => e.toJSON()),
      summary: {
        totalEvents: this.events.length,
        eventTypes: Object.keys(this.eventsByType),
        dateRange: this.events.length > 0 ? {
          start: new Date(Math.min(...this.events.map(e => e.date))),
          end: new Date(Math.max(...this.events.map(e => e.date)))
        } : null
      }
    };
  }
}

/**
 * Helper function to create events from payoff structure components
 */
export function createEventFromComponent(component, date, context = {}) {
  const { type, value, column } = component;
  
  switch (type) {
    case 'OBSERVATION':
      return new ObservationEvent(date, context.observationNumber || 1);
      
    case 'ACTION':
      if (value && value.includes('coupon')) {
        const amount = parseFloat(value.match(/[\d.]+/)?.[0] || 0);
        return new PaymentEvent(date, amount, 'coupon');
      } else if (value && value.includes('autocall')) {
        return new TerminationEvent(date, 'autocall');
      }
      break;
      
    case 'BARRIER':
      const level = parseFloat(component.barrier_level || 100);
      return new BarrierEvent(date, component.barrier_type || 'generic', level);
      
    case 'MEMORY':
      return new MemoryEvent(date, 'coupon');
      
    case 'RANGE':
      return new AccrualEvent(date, 'range');
      
    default:
      return null;
  }
}
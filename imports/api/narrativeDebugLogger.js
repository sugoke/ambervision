/**
 * Narrative Debug Logger for Human-Readable Payoff Explanations
 * 
 * This logger produces clear, business-friendly explanations of what happens
 * during product evaluation, rather than technical debug output.
 */

class NarrativeDebugLogger {
  constructor() {
    this.narrative = [];
    this.isLogging = false;
    this.currentSection = null;
    this.observationNumber = 0;
    this.hasAutocalled = false;
    this.totalCoupons = 0;
    this.memoryAmount = 0;
  }

  startLogging() {
    this.isLogging = true;
    this.narrative = [];
    this.currentSection = null;
    this.observationNumber = 0;
    this.hasAutocalled = false;
    this.totalCoupons = 0;
    this.memoryAmount = 0;
  }

  stopLogging() {
    this.isLogging = false;
  }

  /**
   * Add a narrative step explaining what's happening in business terms
   */
  addNarrativeStep(type, description, details = {}) {
    if (!this.isLogging) return;
    
    const step = {
      id: this.narrative.length + 1,
      type,
      description,
      timestamp: new Date().toISOString(),
      ...details
    };
    
    this.narrative.push(step);
    console.log(`[NARRATIVE] ${description}`);
    
    return step;
  }

  /**
   * Log the start of evaluation
   */
  startEvaluation(product, section) {
    if (!this.isLogging) return;
    
    this.currentSection = section;
    
    if (section === 'life') {
      this.addNarrativeStep('section', 
        '📅 DURING LIFE - Checking observation dates for early redemption opportunities',
        { section: 'life' });
    } else if (section === 'maturity') {
      this.addNarrativeStep('section', 
        '🏁 AT MATURITY - Final evaluation at product expiry',
        { section: 'maturity' });
    }
  }

  /**
   * Log observation date evaluation
   */
  logObservationDate(date, isObservation, observationNumber = null) {
    if (!this.isLogging) return;
    
    const dateStr = new Date(date).toLocaleDateString();
    
    if (isObservation) {
      this.observationNumber++;
      this.addNarrativeStep('observation',
        `📍 Observation Date ${this.observationNumber} (${dateStr}): Checking autocall and coupon conditions`,
        { date: dateStr, observationNumber: this.observationNumber });
    } else if (this.currentSection === 'life') {
      // Not an observation date during life
      return; // Skip non-observation dates
    }
  }

  /**
   * Log underlying performance
   */
  logUnderlyingPerformance(underlyings) {
    if (!this.isLogging) return;
    
    const performances = underlyings.map(u => {
      const perf = ((u.currentPrice - u.strikePrice) / u.strikePrice * 100).toFixed(2);
      return `${u.symbol}: ${u.currentPrice.toFixed(2)} (${perf >= 0 ? '+' : ''}${perf}%)`;
    });
    
    this.addNarrativeStep('underlying',
      `📊 Underlying prices: ${performances.join(', ')}`,
      { underlyings: performances });
    
    // Find worst performer if multiple underlyings
    if (underlyings.length > 1) {
      const worst = underlyings.reduce((min, u) => {
        const perf = ((u.currentPrice - u.strikePrice) / u.strikePrice * 100);
        const minPerf = ((min.currentPrice - min.strikePrice) / min.strikePrice * 100);
        return perf < minPerf ? u : min;
      });
      
      const worstPerf = ((worst.currentPrice - worst.strikePrice) / worst.strikePrice * 100).toFixed(2);
      this.addNarrativeStep('underlying',
        `📉 Worst performer: ${worst.symbol} at ${worstPerf}%`,
        { worstPerformer: worst.symbol, performance: worstPerf });
    }
  }

  /**
   * Log barrier check
   */
  logBarrierCheck(barrierType, barrierLevel, performance, result) {
    if (!this.isLogging) return;
    
    const typeLabel = barrierType === 'autocall' ? 'Autocall' : 
                     barrierType === 'coupon' ? 'Coupon' :
                     barrierType === 'protection' ? 'Protection' : barrierType;
    
    const resultText = result ? '✅ YES' : '❌ NO';
    
    this.addNarrativeStep('barrier_check',
      `🎯 ${typeLabel} Barrier Check: ${performance.toFixed(2)}% vs ${barrierLevel}% barrier = ${resultText}`,
      { 
        barrierType,
        barrierLevel,
        performance,
        result
      });
  }

  /**
   * Log autocall event
   */
  logAutocall(payment) {
    if (!this.isLogging) return;
    
    this.hasAutocalled = true;
    this.addNarrativeStep('action',
      `🎊 AUTOCALLED! Product redeems early. Payment: ${payment.toFixed(2)}% of notional`,
      { 
        type: 'autocall',
        payment,
        outcome: 'Product terminates with early redemption'
      });
  }

  /**
   * Log coupon payment
   */
  logCouponPayment(couponRate, isMemory = false) {
    if (!this.isLogging) return;
    
    if (isMemory) {
      this.memoryAmount += couponRate;
      this.addNarrativeStep('memory',
        `💭 Coupon ${couponRate.toFixed(2)}% stored in memory (Total memory: ${this.memoryAmount.toFixed(2)}%)`,
        { 
          couponRate,
          totalMemory: this.memoryAmount
        });
    } else {
      this.totalCoupons += couponRate;
      this.addNarrativeStep('action',
        `💰 Coupon ${couponRate.toFixed(2)}% paid`,
        { 
          type: 'coupon',
          payment: couponRate
        });
    }
  }

  /**
   * Log memory payout
   */
  logMemoryPayout(memoryAmount, currentCoupon) {
    if (!this.isLogging) return;
    
    const total = memoryAmount + currentCoupon;
    this.addNarrativeStep('action',
      `💰 Coupon with memory paid: ${currentCoupon.toFixed(2)}% + ${memoryAmount.toFixed(2)}% (memory) = ${total.toFixed(2)}%`,
      { 
        type: 'coupon_with_memory',
        currentCoupon,
        memoryAmount,
        totalPayment: total
      });
    
    this.totalCoupons += total;
    this.memoryAmount = 0; // Reset memory after payout
  }

  /**
   * Log protection at maturity
   */
  logProtection(performance, barrierLevel, isProtected) {
    if (!this.isLogging) return;
    
    if (isProtected) {
      this.addNarrativeStep('outcome',
        `✅ CAPITAL PROTECTED: Performance ${performance.toFixed(2)}% is at or above ${barrierLevel}% barrier. Full capital (100%) returned.`,
        { 
          performance,
          barrierLevel,
          capitalReturn: 100,
          protected: true
        });
    } else {
      const capitalReturn = 100 + performance;
      this.addNarrativeStep('outcome',
        `⚠️ BARRIER BREACHED: Performance ${performance.toFixed(2)}% is below ${barrierLevel}% barrier. Capital return: ${capitalReturn.toFixed(2)}%`,
        { 
          performance,
          barrierLevel,
          capitalReturn,
          protected: false
        });
    }
  }

  /**
   * Log participation
   */
  logParticipation(performance, participationRate) {
    if (!this.isLogging) return;
    
    const gain = performance * (participationRate / 100);
    const totalReturn = 100 + gain;
    
    this.addNarrativeStep('outcome',
      `📈 PARTICIPATION: ${participationRate}% of ${performance.toFixed(2)}% performance = ${gain.toFixed(2)}% gain. Total return: ${totalReturn.toFixed(2)}%`,
      { 
        performance,
        participationRate,
        gain,
        totalReturn
      });
  }

  /**
   * Log no event
   */
  logNoEvent(reason = '') {
    if (!this.isLogging) return;
    
    if (this.currentSection === 'life') {
      this.addNarrativeStep('no_event',
        `➡️ No autocall or coupon triggered${reason ? ': ' + reason : ''}. Moving to next observation date.`,
        { reason });
    }
  }

  /**
   * Log final summary
   */
  logSummary(totalReturn, productStatus) {
    if (!this.isLogging) return;
    
    this.addNarrativeStep('summary',
      `📋 FINAL RESULT: Total return ${totalReturn.toFixed(2)}% | Status: ${productStatus}`,
      { 
        totalReturn,
        totalCoupons: this.totalCoupons,
        status: productStatus
      });
  }

  /**
   * Get the narrative steps
   */
  getNarrative() {
    return [...this.narrative];
  }

  /**
   * Clear the narrative
   */
  clearNarrative() {
    this.narrative = [];
  }
}

// Global instance
export const narrativeLogger = new NarrativeDebugLogger();
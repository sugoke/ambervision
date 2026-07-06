/**
 * Rate Evaluation Helpers
 *
 * Supports rate-linked, capital-protected coupon certificates with a Target
 * Redemption (TARN) feature — e.g. a CMS Steepener: fixed coupons for the first
 * N periods, then a floating spread coupon (Max(CMS_long - CMS_short, 0)).
 *
 * IMPORTANT: this template performs NO underlying-price lookups. Coupons are
 * either derived from parameters (the fixed periods) or supplied as manual
 * fixings (the floating periods). Floating coupons that have not been fixed yet
 * are surfaced as "pending fixing" — the cumulative total is only defined up to
 * the first unknown coupon.
 *
 * Coupon math (documented assumption, parameterised by couponFrequency):
 *   periodCoupon(% of nominal) = annualRatePa × dayCountFraction
 *   quarterly 30/360 → dayCountFraction = 0.25
 *   Cumulative = running sum of period coupons.
 *   TARN: when Cumulative ≥ targetCoupon the note redeems early; the triggering
 *   period's coupon is capped so the lifetime total lands exactly on the target.
 */
export const RateEvaluationHelpers = {
  getPeriodsPerYear(frequency) {
    switch ((frequency || 'quarterly').toLowerCase()) {
      case 'monthly': return 12;
      case 'quarterly': return 4;
      case 'semi-annually':
      case 'semi_annual':
      case 'semiannual': return 2;
      case 'annually':
      case 'annual': return 1;
      default: return 4;
    }
  },

  getDayCountFraction(frequency) {
    return 1 / this.getPeriodsPerYear(frequency);
  },

  formatPct(value, dp = 2) {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    return `${value.toFixed(dp)}%`;
  },

  formatDate(date) {
    if (!date) return null;
    return new Date(date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatCurrency(amount, currency = 'EUR') {
    if (amount === null || amount === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(amount);
  },

  /**
   * Build the period list from the product's observationSchedule, or generate a
   * simple periodic schedule from trade date → final observation if absent.
   * Returns [{ periodIndex, observationDate, paymentDate }].
   */
  buildPeriods(product, params) {
    const sched = Array.isArray(product.observationSchedule) ? product.observationSchedule : [];
    if (sched.length > 0) {
      return sched
        .map((o, i) => ({
          periodIndex: o.periodIndex || (i + 1),
          observationDate: o.observationDate || o.date || null,
          paymentDate: o.valueDate || o.paymentDate || o.observationDate || o.date || null
        }))
        .sort((a, b) => a.periodIndex - b.periodIndex);
    }

    // Fallback: generate periodic dates from trade → final observation.
    const start = product.tradeDate || product.valueDate || product.initialDate;
    const end = product.finalObservation || product.finalObservationDate || product.maturity || product.maturityDate;
    if (!start || !end) return [];
    const monthsStep = 12 / this.getPeriodsPerYear(params.couponFrequency);
    const startD = new Date(start);
    const endD = new Date(end);
    const periods = [];
    let idx = 1;
    while (true) {
      const d = new Date(startD);
      d.setMonth(d.getMonth() + Math.round(idx * monthsStep));
      const capped = d > endD ? new Date(endD) : d;
      const iso = capped.toISOString().split('T')[0];
      periods.push({ periodIndex: idx, observationDate: iso, paymentDate: iso });
      if (capped.getTime() >= endD.getTime()) break;
      idx++;
      if (idx > 600) break; // safety
    }
    return periods;
  },

  /**
   * Resolve the annual coupon rate (% p.a.) for a period.
   * Fixed periods → fixedCouponRate. Floating → manual fixing if present
   * (couponRatePa, or Max(cms30 - cms5, 0) when both are supplied), else null = pending.
   */
  resolvePeriodCoupon(periodIndex, params, fixings) {
    if (periodIndex <= params.fixedPeriods) {
      return { annualRatePa: params.fixedCouponRate, type: 'fixed' };
    }
    const f = fixings ? fixings.find(x => (x.periodIndex || x.period) === periodIndex) : null;
    if (f) {
      if (f.couponRatePa !== undefined && f.couponRatePa !== null) {
        return { annualRatePa: Number(f.couponRatePa), type: 'floating' };
      }
      if (f.cms30 !== undefined && f.cms5 !== undefined && f.cms30 !== null && f.cms5 !== null) {
        return { annualRatePa: Math.max(Number(f.cms30) - Number(f.cms5), 0), type: 'floating' };
      }
    }
    return { annualRatePa: null, type: 'floating' }; // pending fixing
  },

  /**
   * Compute the full coupon schedule, running cumulative, and TARN trigger.
   */
  computeSchedule(product, params, fixings) {
    const dcf = this.getDayCountFraction(params.couponFrequency);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const target = params.targetEnabled ? params.targetCoupon : null;

    const basePeriods = this.buildPeriods(product, params);

    let cumulative = 0;
    let cumulativeKnown = true; // false once we hit the first pending coupon
    let redeemed = false;
    let redemptionDate = null;
    let redemptionPeriodIndex = null;
    let finalCoupon = null;

    const periods = basePeriods.map((p) => {
      const resolved = this.resolvePeriodCoupon(p.periodIndex, params, fixings);
      const annualRatePa = resolved.annualRatePa;
      let periodCoupon = annualRatePa === null ? null : annualRatePa * dcf;

      // Once redeemed, later periods are cancelled.
      if (redeemed) {
        return {
          periodIndex: p.periodIndex,
          observationDate: p.observationDate,
          observationDateFormatted: this.formatDate(p.observationDate),
          paymentDate: p.paymentDate,
          paymentDateFormatted: this.formatDate(p.paymentDate),
          couponType: resolved.type,
          annualRatePa: null,
          annualRatePaFormatted: '—',
          periodCoupon: null,
          periodCouponFormatted: '—',
          cumulativeCoupon: null,
          cumulativeCouponFormatted: '—',
          status: 'cancelled',
          isPending: false
        };
      }

      let status;
      let cumulativeCoupon = null;

      if (periodCoupon === null) {
        // Floating coupon not yet fixed → pending; cumulative becomes indeterminate.
        cumulativeKnown = false;
        status = 'pending_fixing';
      } else {
        if (cumulativeKnown) {
          // Apply TARN cap if this period would cross the target.
          if (target !== null && cumulative + periodCoupon >= target) {
            periodCoupon = Math.max(target - cumulative, 0); // Final Interest Rate cap
            cumulative = target;
            cumulativeCoupon = cumulative;
            redeemed = true;
            redemptionDate = p.paymentDate;
            redemptionPeriodIndex = p.periodIndex;
            finalCoupon = periodCoupon;
          } else {
            cumulative += periodCoupon;
            cumulativeCoupon = cumulative;
          }
        }
        const paymentPassed = p.paymentDate && (typeof p.paymentDate === 'string'
          ? p.paymentDate <= todayStr
          : new Date(p.paymentDate).toISOString().split('T')[0] <= todayStr);
        status = redeemed ? 'redeemed' : (paymentPassed ? 'paid' : 'upcoming');
      }

      return {
        periodIndex: p.periodIndex,
        observationDate: p.observationDate,
        observationDateFormatted: this.formatDate(p.observationDate),
        paymentDate: p.paymentDate,
        paymentDateFormatted: this.formatDate(p.paymentDate),
        couponType: resolved.type,
        annualRatePa,
        annualRatePaFormatted: annualRatePa === null ? 'Pending' : this.formatPct(annualRatePa),
        periodCoupon,
        periodCouponFormatted: periodCoupon === null ? 'Pending' : this.formatPct(periodCoupon),
        cumulativeCoupon,
        cumulativeCouponFormatted: cumulativeCoupon === null ? '—' : this.formatPct(cumulativeCoupon),
        status,
        isPending: periodCoupon === null
      };
    });

    // Known cumulative = the last defined cumulativeCoupon value.
    let knownCumulative = 0;
    for (const p of periods) {
      if (p.cumulativeCoupon !== null && p.cumulativeCoupon !== undefined) knownCumulative = p.cumulativeCoupon;
    }

    const anyPending = periods.some(p => p.status === 'pending_fixing');
    const targetProgressPct = target ? Math.min((knownCumulative / target) * 100, 100) : null;

    return {
      periods,
      dayCountFraction: dcf,
      knownCumulative,
      anyPending,
      target,
      targetProgressPct,
      redeemed,
      redemptionDate,
      redemptionPeriodIndex,
      finalCoupon
    };
  },

  /**
   * Build the product status block (live / matured / redeemed).
   */
  buildProductStatus(product, schedule) {
    const now = new Date();
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const hasMatured = now > maturityDate;
    const daysToMaturity = Math.ceil((maturityDate - now) / (1000 * 60 * 60 * 24));

    let productStatus = 'live';
    if (schedule.redeemed) productStatus = 'redeemed';
    else if (hasMatured) productStatus = 'matured';

    return {
      productStatus,
      statusDetails: {
        hasMatured,
        isRedeemed: schedule.redeemed,
        maturityDate: product.maturity || product.maturityDate,
        maturityDateFormatted: this.formatDate(product.maturity || product.maturityDate)
      },
      evaluationDate: now,
      evaluationDateFormatted: this.formatDate(now),
      daysToMaturity,
      daysToMaturityText: hasMatured
        ? `${Math.abs(daysToMaturity)} days (matured)`
        : `${daysToMaturity} days remaining`,
      hasMatured
    };
  }
};

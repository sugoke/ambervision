// Athena payoff arithmetic.
//
// Pure functions (no Meteor), shared by the evaluator and the tests. Every level is a %
// of the initial fixing (80 = 80% of initial) and every amount a % of notional
// (120 = N x 120%).
//
// Final payoff tiers, ordered by descending `fromLevel`; the first tier whose
// fromLevel the worst-of level reaches applies:
//   { fromLevel, type: 'fixed',  amount }                 -> amount
//   { fromLevel, type: 'linear', base, gearing, strike }  -> base + gearing% x (level - strike)
// e.g. BNP CE12997CLV: >= 80 -> 120; >= 16 -> 100 + 125% x (level - 80); otherwise 0.

const toNumber = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));

const fmt = (n, decimals = 2) => {
  const fixed = Number(n).toFixed(decimals);
  // 120.00 -> 120, 112.50 -> 112.5
  return decimals > 0 ? fixed.replace(/\.?0+$/, '') : fixed;
};

export const AthenaEvaluationHelpers = {
  /**
   * Tiers as numbers, ordered from the highest fromLevel down. Rows without a
   * usable fromLevel are dropped; a missing bottom tier means "nothing below".
   */
  normalizeTiers(tiers = []) {
    return (Array.isArray(tiers) ? tiers : [])
      .map(t => ({
        fromLevel: toNumber(t?.fromLevel),
        type: t?.type === 'linear' ? 'linear' : 'fixed',
        amount: toNumber(t?.amount),
        base: toNumber(t?.base),
        gearing: toNumber(t?.gearing),
        strike: toNumber(t?.strike)
      }))
      .filter(t => t.fromLevel !== null)
      .sort((a, b) => b.fromLevel - a.fromLevel);
  },

  /** Payout (% of notional) of one tier at a worst-of level (% of initial), never below 0 */
  tierPayout(tier, level) {
    if (tier.type === 'linear') {
      const raw = (tier.base ?? 0) + ((tier.gearing ?? 0) / 100) * (level - (tier.strike ?? 0));
      return Math.max(0, raw);
    }
    return Math.max(0, tier.amount ?? 0);
  },

  /**
   * Final redemption at a worst-of level.
   * @param {number} level worst-of level in % of initial (e.g. 85 for -15%)
   * @returns {{payout:number|null, tierIndex:number, tier:object|null}}
   */
  evaluateFinalTiers(level, tiers) {
    const ordered = this.normalizeTiers(tiers);
    if (level === null || level === undefined || isNaN(level) || ordered.length === 0) {
      return { payout: null, tierIndex: -1, tier: null };
    }
    const tierIndex = ordered.findIndex(t => level >= t.fromLevel);
    if (tierIndex === -1) {
      // Below every tier: the term sheet's "otherwise" case is missing, nothing is due
      return { payout: 0, tierIndex: -1, tier: null };
    }
    const tier = ordered[tierIndex];
    return { payout: this.tierPayout(tier, level), tierIndex, tier };
  },

  /** Formula of a tier, e.g. "120%" or "100% + 125% × (perf − 80%)" */
  describeTierFormula(tier) {
    if (tier.type === 'linear') {
      return `${fmt(tier.base ?? 0)}% + ${fmt(tier.gearing ?? 0)}% × (worst-of − ${fmt(tier.strike ?? 0)}%)`;
    }
    return `${fmt(tier.amount ?? 0)}%`;
  },

  /** Level range of tier i, e.g. "≥ 80%", "16% – 80%", "< 16%" */
  describeTierRange(ordered, index) {
    const tier = ordered[index];
    if (index === 0) return `≥ ${fmt(tier.fromLevel)}%`;
    const upper = ordered[index - 1].fromLevel;
    if (tier.fromLevel <= 0) return `< ${fmt(upper)}%`;
    return `${fmt(tier.fromLevel)}% – ${fmt(upper)}%`;
  },

  /** Display rows for the tier table, the active tier flagged */
  describeTiers(tiers, activeIndex = -1) {
    const ordered = this.normalizeTiers(tiers);
    return ordered.map((tier, i) => ({
      ...tier,
      rangeLabel: this.describeTierRange(ordered, i),
      formulaLabel: this.describeTierFormula(tier),
      isActive: i === activeIndex
    }));
  },

  /**
   * Highest worst-of level below which the final redemption falls under 100% of
   * notional: the level the capital is at risk from. Null when it never does.
   */
  capitalAtRiskLevel(tiers) {
    const ordered = this.normalizeTiers(tiers);
    for (let i = 0; i < ordered.length; i++) {
      const tier = ordered[i];
      const upper = i === 0 ? Infinity : ordered[i - 1].fromLevel;
      if (tier.type === 'fixed') {
        if ((tier.amount ?? 0) < 100) return i === 0 ? tier.fromLevel : upper;
        continue;
      }
      const g = (tier.gearing ?? 0) / 100;
      if (g <= 0) {
        if ((tier.base ?? 0) < 100) return i === 0 ? tier.fromLevel : upper;
        continue;
      }
      // base + g (L - strike) < 100  <=>  L < strike + (100 - base) / g
      const breakEven = (tier.strike ?? 0) + (100 - (tier.base ?? 0)) / g;
      if (breakEven > tier.fromLevel) return Math.min(upper, breakEven);
    }
    // The bottom tier ends at its fromLevel: anything lower is not covered (pays 0)
    const last = ordered[ordered.length - 1];
    return last && last.fromLevel > 0 ? last.fromLevel : null;
  },

  /** Return (%) on the price paid: 120 received for 66.90 paid -> +79.37 */
  returnOnIssuePrice(amount, issuePrice) {
    if (amount === null || amount === undefined || !issuePrice) return null;
    return (amount / issuePrice - 1) * 100;
  },

  /** Annualised return (%) between two dates, compounding on an Act/365 basis */
  annualizedReturn(amount, issuePrice, startDate, endDate) {
    if (amount === null || amount === undefined || !issuePrice || !startDate || !endDate) return null;
    const days = (new Date(endDate) - new Date(startDate)) / 86400000;
    if (!(days > 0)) return null;
    const ratio = amount / issuePrice;
    if (ratio <= 0) return -100;
    return (Math.pow(ratio, 365 / days) - 1) * 100;
  },

  formatPercent(value, { decimals = 2, signed = false } = {}) {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    const sign = signed && value > 0 ? '+' : '';
    return `${sign}${Number(value).toFixed(decimals)}%`;
  },

  /** Short level label: 100 -> "100%", 112.5 -> "112.5%" */
  formatLevel(value) {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    return `${fmt(value)}%`;
  },

  formatDate(date) {
    if (!date) return null;
    return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
};

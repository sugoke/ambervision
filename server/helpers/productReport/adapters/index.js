/**
 * Payoff adapters, keyed by the report's templateId. An adapter turns one
 * evaluator's templateResults into the report's common blocks (headline,
 * underlyings, payoff, schedule, parameters, how it works). A template without
 * an adapter gets the generic one: underlyings and the product's facts.
 */
import phoenix from './phoenix.js';
import { underlyingsOf } from '../common.js';

const generic = {
  templateKey: null,
  build({ results, f, t }) {
    return {
      headline: null,
      underlyings: underlyingsOf(results, f, t, { withDistance: false }),
      payoff: null,
      schedule: null,
      parameters: [],
      howItWorks: []
    };
  }
};

const ADAPTERS = {
  phoenix_autocallable: phoenix
};

export const adapterFor = (templateId) => ADAPTERS[templateId] || generic;

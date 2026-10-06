/**
 * Payoff adapters, keyed by the report's templateId. An adapter turns one
 * evaluator's templateResults into the report's common blocks (headline,
 * underlyings, payoff, schedule, parameters, how it works). A template without
 * an adapter gets the generic one: underlyings and the product's facts.
 */
import phoenix from './phoenix.js';
import orion from './orion.js';
import himalaya from './himalaya.js';
import sharkNote from './sharkNote.js';
import participationNote from './participationNote.js';
import reverseConvertible from './reverseConvertible.js';
import reverseConvertibleBond from './reverseConvertibleBond.js';
import bonusCertificate from './bonusCertificate.js';
import twinWin from './twinWin.js';
import rate from './rate.js';
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
  phoenix_autocallable: phoenix,
  orion_memory: orion,
  himalaya,
  shark_note: sharkNote,
  participation_note: participationNote,
  reverse_convertible: reverseConvertible,
  reverse_convertible_bond: reverseConvertibleBond,
  bonus_certificate: bonusCertificate,
  twin_win: twinWin,
  rate
};

export const adapterFor = (templateId) => ADAPTERS[templateId] || generic;

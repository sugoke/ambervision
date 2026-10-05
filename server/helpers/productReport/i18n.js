/**
 * Labels of the product report PDF, English and French. The evaluators write
 * their explanations in English only, so every sentence the PDF shows is
 * composed here from the report's raw values instead (see the adapters).
 */

const EN = {
  docKicker: 'Structured product report',
  reportDate: 'Report date',
  evaluationDate: 'Evaluation',
  currency: 'Currency',
  issuer: 'Issuer',
  isin: 'ISIN',
  status: 'Status',
  contents: 'Contents',
  privateConfidential: 'Private and confidential',
  footerLeft: 'Amberlake Partners SAM · Private and confidential',
  footerMiddle: 'SEC registered · CCAF regulated',
  coverAddress: 'Amberlake Partners SAM · 38 Boulevard des Moulins, MC 98000 Monaco · amberlakepartners.com',

  statusLive: 'Live', statusAutocalled: 'Autocalled', statusMatured: 'Matured', statusRedeemed: 'Redeemed', statusCalled: 'Called',

  sectionOverview: 'Overview', sectionPayoff: 'Payoff', sectionPerformance: 'Performance', sectionSchedule: 'Schedule', sectionNotes: 'Notes',
  titleOverview: 'Product at a glance',
  titlePerformance: 'Performance since launch',
  titleSchedule: 'Observation schedule',
  titleNotes: 'Structure and notes',

  timeline: 'Timeline',
  tradeDate: 'Trade date', valueDate: 'Value date', finalObservation: 'Final observation', maturity: 'Maturity',
  marketPrice: 'Market price', finalPrice: 'Final price', ofPar: 'of par', priceAsOf: 'as of {date}',
  daysToFinal: 'Final observation in', days: '{n} days', day: '1 day',

  underlyings: 'Underlyings',
  colUnderlying: 'Underlying', colInitial: 'Initial', colCurrent: 'Current', colPerformance: 'Performance', colDistance: 'Distance to barrier', colStatus: 'Status',
  barSafe: 'Safe', barNear: 'Near barrier', barBreached: 'Below barrier',
  performanceVsBarrier: 'Performance against the {barrier} barrier',
  worstNote: 'Worst-performing underlying, which drives the product',
  worstOf: 'Worst-of', bestOf: 'Best-of', average: 'Average', basketOf: '{n} underlyings',
  priceDate: 'Prices of {date}',

  chartCaption: 'Underlyings rebased to 100 at launch; dashed lines show the product levels. The axis runs to maturity.',
  obsShort: 'Obs {n}',

  parameters: 'Parameters', howItWorks: 'How it works', sources: 'Data and sources', notice: 'Important notice', yourContact: 'Your contact', regulatory: 'Regulatory information',
  generated: 'Report generated {date}',
  sourceText: 'Evaluation of {date}, closing prices of the underlyings',
  noticeText: [
    'This report is prepared by Amberlake Partners SAM for information purposes only, on the basis of the product\'s terms and of market data believed to be reliable. It is not an official valuation of the issuer.',
    'Indicative values assume the product ended on the evaluation date at current prices; the amount actually paid depends on the levels observed on the dates set in the term sheet, which prevails in case of any difference.',
    'Past performance is not a reliable indicator of future results. Structured products carry the credit risk of their issuer and may lose part or all of the capital invested. Nothing in this report constitutes investment, legal or tax advice, nor an offer or solicitation to buy or sell any financial instrument.'
  ],
  yes: 'Yes', no: 'No',

  // Phoenix
  tplPhoenix: 'Phoenix autocallable',
  titlePayoffPhoenix: 'Coupons and redemption',
  autocallLevel: 'Autocall level', protectionBarrier: 'Protection barrier', couponBarrier: 'Coupon barrier', couponRate: 'Coupon',
  observationFrequency: 'Observations', memoryCoupon: 'Memory coupon', memoryAutocall: 'Memory autocall', guaranteedCoupon: 'Guaranteed coupon', basket: 'Basket',
  freqMonthly: 'monthly', freqQuarterly: 'quarterly', freqSemiannual: 'semi-annual', freqAnnual: 'annual',
  perPeriod: '{rate} per {period}', periodMonth: 'month', periodQuarter: 'quarter', periodSemester: 'half-year', periodYear: 'year',
  stepDown: '{from} down to {to}',
  couponsEarned: 'Coupons received', couponsInMemory: 'Coupons in memory', observationsDone: 'Observations', remainingObs: '{done} of {total} done',
  nextObservation: 'Next observation', nextIn: 'in {days} days',
  indicativeValue: 'Indicative value if matured today', finalRedemption: 'Final redemption', autocallRedemption: 'Redemption at autocall',
  basketLevel: 'Basket level', capitalReturn: 'Capital repaid', couponsTotal: 'Coupons', memoryForfeit: 'Coupons in memory (lost)', totalValue: 'Total', pnl: 'Gain or loss',
  basketPerfOfInitial: '{level} of initial',
  capitalIntact: 'The basket is at {level} of its initial level, above the {barrier} barrier: the capital is repaid in full.',
  capitalBelow: 'The basket is at {level} of its initial level, below the {barrier} barrier: the capital is repaid at {capital}.',
  outcomeAutocall: 'At {level} the basket is at or above the autocall level of {autocall}: the product would be called, paying {redemption}.',
  outcomeCoupon: 'At {level} the basket is at or above the coupon barrier of {barrier}: a coupon of {coupon} would be paid.',
  outcomeMemoryAdded: 'At {level} the basket is below the coupon barrier of {barrier}: {coupon} would go into memory (total {total}).',
  outcomeMemoryPaid: 'At {level} the basket is at or above the coupon barrier of {barrier}: the coupon and those in memory would be paid ({total}).',
  outcomeNoEvent: 'At {level} no coupon or autocall would be triggered.',
  outcomeFinal: 'Final observation: the product would repay {redemption}.',
  basedOnCurrent: 'Based on current prices of the underlyings.',
  colObservation: 'Observation', colPayment: 'Payment', colType: 'Type', colAutocall: 'Autocall', colBasket: 'Basket', colCoupon: 'Coupon', colMemory: 'Memory', colOutcome: 'Outcome',
  typeCoupon: 'Coupon', typeAutocallCoupon: 'Autocall and coupon', typeFinal: 'Final',
  outPaid: 'Coupon paid', outMemory: 'Into memory', outAutocalled: 'Autocalled', outUpcoming: 'Upcoming', outNext: 'Next', outNone: 'No coupon', outMatured: 'Matured',
  howPhoenix: 'On each observation date, if the {basket} is at or above the coupon barrier, a coupon is paid{memory}. If it is at or above the autocall level, the product is redeemed early at 100% plus the coupon. At final observation, the capital is repaid in full if the basket is at or above the {barrier} protection barrier; below it, the capital is reduced in line with the basket\'s fall.',
  howPhoenixMemory: ', together with any coupons previously missed',
  basketWorst: 'worst-performing underlying', basketBest: 'best-performing underlying', basketAvg: 'average of the underlyings'
};

const FR = {
  docKicker: 'Rapport de produit structuré',
  reportDate: 'Date du rapport',
  evaluationDate: 'Évaluation',
  currency: 'Devise',
  issuer: 'Émetteur',
  isin: 'ISIN',
  status: 'Statut',
  contents: 'Sommaire',
  privateConfidential: 'Privé et confidentiel',
  footerLeft: 'Amberlake Partners SAM · Privé et confidentiel',
  footerMiddle: 'Enregistré SEC · Agréé CCAF',
  coverAddress: 'Amberlake Partners SAM · 38 Boulevard des Moulins, MC 98000 Monaco · amberlakepartners.com',

  statusLive: 'En vie', statusAutocalled: 'Rappelé', statusMatured: 'Échu', statusRedeemed: 'Remboursé', statusCalled: 'Rappelé',

  sectionOverview: 'Synthèse', sectionPayoff: 'Mécanisme', sectionPerformance: 'Performance', sectionSchedule: 'Calendrier', sectionNotes: 'Notes',
  titleOverview: 'Le produit en bref',
  titlePerformance: 'Performance depuis le lancement',
  titleSchedule: 'Calendrier des observations',
  titleNotes: 'Structure et notes',

  timeline: 'Calendrier',
  tradeDate: 'Date de transaction', valueDate: 'Date de valeur', finalObservation: 'Observation finale', maturity: 'Échéance',
  marketPrice: 'Prix de marché', finalPrice: 'Prix final', ofPar: 'du nominal', priceAsOf: 'au {date}',
  daysToFinal: 'Observation finale dans', days: '{n} jours', day: '1 jour',

  underlyings: 'Sous-jacents',
  colUnderlying: 'Sous-jacent', colInitial: 'Initial', colCurrent: 'Actuel', colPerformance: 'Performance', colDistance: 'Distance à la barrière', colStatus: 'Statut',
  barSafe: 'Sûr', barNear: 'Proche de la barrière', barBreached: 'Sous la barrière',
  performanceVsBarrier: 'Performance face à la barrière de {barrier}',
  worstNote: 'Sous-jacent le moins performant, qui détermine le produit',
  worstOf: 'Worst-of', bestOf: 'Best-of', average: 'Moyenne', basketOf: '{n} sous-jacents',
  priceDate: 'Cours du {date}',

  chartCaption: 'Sous-jacents en base 100 au lancement ; les pointillés indiquent les niveaux du produit. L\'axe va jusqu\'à l\'échéance.',
  obsShort: 'Obs. {n}',

  parameters: 'Paramètres', howItWorks: 'Fonctionnement', sources: 'Données et sources', notice: 'Avertissement', yourContact: 'Votre contact', regulatory: 'Informations réglementaires',
  generated: 'Rapport établi le {date}',
  sourceText: 'Évaluation du {date}, cours de clôture des sous-jacents',
  noticeText: [
    'Ce rapport est établi par Amberlake Partners SAM à titre d\'information, sur la base des conditions du produit et de données de marché jugées fiables. Il ne constitue pas une valorisation officielle de l\'émetteur.',
    'Les valeurs indicatives supposent que le produit prend fin à la date d\'évaluation aux cours actuels ; le montant effectivement versé dépend des niveaux constatés aux dates prévues par la term sheet, qui prévaut en cas de différence.',
    'Les performances passées ne préjugent pas des performances futures. Les produits structurés comportent le risque de crédit de leur émetteur et peuvent entraîner la perte partielle ou totale du capital investi. Ce rapport ne constitue ni un conseil en investissement, juridique ou fiscal, ni une offre ou sollicitation d\'achat ou de vente d\'un instrument financier.'
  ],
  yes: 'Oui', no: 'Non',

  tplPhoenix: 'Phoenix autocallable',
  titlePayoffPhoenix: 'Coupons et remboursement',
  autocallLevel: 'Niveau de rappel', protectionBarrier: 'Barrière de protection', couponBarrier: 'Barrière de coupon', couponRate: 'Coupon',
  observationFrequency: 'Observations', memoryCoupon: 'Coupon mémoire', memoryAutocall: 'Rappel mémoire', guaranteedCoupon: 'Coupon garanti', basket: 'Panier',
  freqMonthly: 'mensuelles', freqQuarterly: 'trimestrielles', freqSemiannual: 'semestrielles', freqAnnual: 'annuelles',
  perPeriod: '{rate} par {period}', periodMonth: 'mois', periodQuarter: 'trimestre', periodSemester: 'semestre', periodYear: 'an',
  stepDown: 'de {from} à {to}',
  couponsEarned: 'Coupons reçus', couponsInMemory: 'Coupons en mémoire', observationsDone: 'Observations', remainingObs: '{done} sur {total} passées',
  nextObservation: 'Prochaine observation', nextIn: 'dans {days} jours',
  indicativeValue: 'Valeur indicative si échéance aujourd\'hui', finalRedemption: 'Remboursement final', autocallRedemption: 'Remboursement au rappel',
  basketLevel: 'Niveau du panier', capitalReturn: 'Capital remboursé', couponsTotal: 'Coupons', memoryForfeit: 'Coupons en mémoire (perdus)', totalValue: 'Total', pnl: 'Gain ou perte',
  basketPerfOfInitial: '{level} du niveau initial',
  capitalIntact: 'Le panier est à {level} de son niveau initial, au-dessus de la barrière de {barrier} : le capital est intégralement remboursé.',
  capitalBelow: 'Le panier est à {level} de son niveau initial, sous la barrière de {barrier} : le capital est remboursé à {capital}.',
  outcomeAutocall: 'À {level}, le panier est au niveau de rappel de {autocall} ou au-dessus : le produit serait rappelé et verserait {redemption}.',
  outcomeCoupon: 'À {level}, le panier est à la barrière de coupon de {barrier} ou au-dessus : un coupon de {coupon} serait versé.',
  outcomeMemoryAdded: 'À {level}, le panier est sous la barrière de coupon de {barrier} : {coupon} serait mis en mémoire (total {total}).',
  outcomeMemoryPaid: 'À {level}, le panier est à la barrière de coupon de {barrier} ou au-dessus : le coupon et ceux en mémoire seraient versés ({total}).',
  outcomeNoEvent: 'À {level}, ni coupon ni rappel ne seraient déclenchés.',
  outcomeFinal: 'Observation finale : le produit rembourserait {redemption}.',
  basedOnCurrent: 'Sur la base des cours actuels des sous-jacents.',
  colObservation: 'Observation', colPayment: 'Paiement', colType: 'Type', colAutocall: 'Rappel', colBasket: 'Panier', colCoupon: 'Coupon', colMemory: 'Mémoire', colOutcome: 'Résultat',
  typeCoupon: 'Coupon', typeAutocallCoupon: 'Rappel et coupon', typeFinal: 'Finale',
  outPaid: 'Coupon versé', outMemory: 'Mis en mémoire', outAutocalled: 'Rappelé', outUpcoming: 'À venir', outNext: 'Prochaine', outNone: 'Pas de coupon', outMatured: 'Échu',
  howPhoenix: 'À chaque date d\'observation, si le {basket} est à la barrière de coupon ou au-dessus, un coupon est versé{memory}. S\'il est au niveau de rappel ou au-dessus, le produit est remboursé par anticipation à 100 % plus le coupon. À l\'observation finale, le capital est intégralement remboursé si le panier est à la barrière de protection de {barrier} ou au-dessus ; en dessous, le capital est réduit à proportion de la baisse du panier.',
  howPhoenixMemory: ', ainsi que les coupons non versés précédemment',
  basketWorst: 'sous-jacent le moins performant', basketBest: 'sous-jacent le plus performant', basketAvg: 'panier (moyenne des sous-jacents)'
};

const DICTS = { en: EN, fr: FR };

/** Translator for one language: t('key', { var }) with English fallback. */
export const translatorFor = (lang = 'en') => {
  const dict = DICTS[lang] || EN;
  return (key, vars = {}) => {
    const raw = dict[key] ?? EN[key] ?? key;
    if (typeof raw !== 'string') return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
  };
};

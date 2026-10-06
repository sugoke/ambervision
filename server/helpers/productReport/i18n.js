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

// Labels of the other payoffs (Orion, Himalaya, Shark, Participation, Reverse
// Convertible and its bond variant, Bonus, Twin Win, Rate) and shared notices
const EN_MORE = {
  noPrice: 'No current price',
  missingPrices: 'No current price was available for {list} at the evaluation: values depending on it are not shown.',
  barrierAmerican: 'American (continuous)', barrierEuropean: 'European (at final observation)',
  barrierType: 'Barrier observation', barrierLevel: 'Barrier', strikeLevel: 'Strike', participationRate: 'Participation', capitalProtection: 'Capital protection',
  redemptionValue: 'Redemption', indicativeRedemption: 'Indicative redemption if matured today',
  colConsidered: 'Counted performance', colDistanceLower: 'Distance to lower barrier',

  tplOrion: 'Orion', titlePayoffOrion: 'Performance and redemption',
  upperBarrier: 'Upper barrier', rebate: 'Rebate', capitalGuaranteed: 'Capital guaranteed', lowerBarrier: 'Lower barrier',
  orionCapped: 'Capped at rebate', orionParticipating: 'Participating',
  countedPerformances: 'Performances counted', basketCounted: 'Basket (average counted)',
  orionNoneHit: 'No underlying has reached the {upper} upper barrier: each counts with its own performance, and the capital is guaranteed at {guarantee}.',
  orionSomeHit: '{n} of {total} underlyings reached the {upper} upper barrier and count for the {rebate} rebate; the others count with their own performance. The capital is guaranteed at {guarantee}.',
  howOrion: 'Each underlying counts with its own performance from the start, unless it reaches the {upper} upper barrier during the life of the product: it then counts for a fixed {rebate}. At maturity the product repays the capital plus the average of the counted performances, and at least {guarantee} of the capital.',

  tplHimalaya: 'Himalaya', titlePayoffHimalaya: 'Selection and payout',
  floor: 'Floor', averagePerformance: 'Average of the recorded performances', payout: 'Payout', selectionDone: 'Underlyings recorded',
  titleSelection: 'Observation and selection', colNumber: 'No.', colSelected: 'Underlying recorded', colRemaining: 'Remaining',
  selFrozen: 'Recorded', selPending: 'To come',
  himalayaText: 'The average of the performances recorded so far is {avg}; with the {floor} floor the product would pay {payout}.',
  howHimalaya: 'On each observation date, the best-performing underlying still in the basket is recorded with its performance and removed. At maturity the product pays the capital plus the average of the recorded performances, with a floor at {floor}.',

  tplShark: 'Shark note', titlePayoffShark: 'Barrier and redemption',
  barrierTouched: 'Upper barrier touched', barrierNotTouched: 'Upper barrier not touched', touchedOn: 'on {date}',
  sharkText: 'Redemption at {value}.',
  howShark: 'If the reference performance reaches the {upper} upper barrier during the life of the product, the product repays the capital plus a fixed {rebate}. Otherwise it repays the capital plus the performance at maturity, with a floor at {floor}.',

  tplParticipation: 'Participation note', titlePayoffParticipation: 'Participation and redemption',
  basketPerformance: 'Reference performance', participatedPerformance: 'Performance with participation', protectionLevel: 'Protection', rawRedemption: 'Redemption before protection',
  partProtected: 'With participation the redemption would be {raw}, below the {protection} protection: the product repays {value}.',
  partNormal: 'With participation the product would repay {value}.',
  issuerCall: 'Issuer call', callable: 'Callable by the issuer', calledOn: 'Called on {date}', notCalled: 'Not called', callPrice: 'Call price', noCallOption: 'No call option',
  refWorst: 'Worst performer', refBest: 'Best performer', refAverage: 'Average of the underlyings', refSingle: 'Single underlying',
  howParticipation: 'At maturity the product repays the capital plus {rate} of the reference performance ({reference}){protection}.',
  howParticipationProtection: ', and at least {protection} of the capital',
  titleCallSchedule: 'Call schedule', colCallable: 'Callable', colRebate: 'Rebate',

  tplReverseConvertible: 'Reverse convertible', titlePayoffRC: 'Coupon and redemption',
  gearing: 'Gearing', capitalComponent: 'Capital repaid', couponComponent: 'Coupon', barrierBreached: 'The barrier has been breached',
  rcIntact: 'The underlyings are above the {barrier} barrier: the capital is repaid in full, plus the coupon.',
  rcBreached: 'An underlying is below the {barrier} barrier: the capital is repaid at {capital}, plus the coupon.',
  howRC: 'The product pays a coupon of {coupon}. At maturity the capital is repaid in full if no underlying is below the {barrier} barrier; otherwise the capital follows the fall of the worst underlying.',

  tplReverseConvertibleBond: 'Reverse convertible on bond', titlePayoffRCB: 'Strike and redemption',
  bondLevel: 'Bond price', distanceToStrike: 'Distance to strike', settlement: 'Settlement', settleCash: 'Cash at par', settlePhysical: 'Delivery of the bond',
  conversionRatio: 'Conversion ratio', denomination: 'Denomination',
  strikeAbove: 'At or above strike', strikeBelow: 'Below strike',
  rcbCash: 'The bond is above the {strike} strike: the note is repaid at par in cash, plus the coupon.',
  rcbPhysical: 'The bond is at or below the {strike} strike: the note is settled by delivery of the bond ({ratio} bonds per note), plus the coupon.',
  howRCB: 'The note pays a coupon of {coupon}. At maturity it is repaid at par in cash if the bond is above the {strike} strike; at or below it, the bond is delivered at the conversion ratio.',

  tplBonus: 'Bonus certificate', titlePayoffBonus: 'Knock-in and redemption',
  bonusLevel: 'Bonus level', cap: 'Cap', maxRedemption: 'Maximum redemption', bonusOrUpside: 'Bonus or upside', knockIn: 'Knock-in barrier',
  kiOccurred: 'Knock-in on {date}', kiNotYet: 'Observed at final observation only', kiNone: 'No knock-in so far',
  bonusText: 'At today\'s level the certificate would repay {total}.',
  howBonus: 'At maturity, if the knock-in barrier at {barrier} has not been breached, the certificate repays at least the {bonus} bonus level, plus {rate} of any rise above it{cap}. If the barrier has been breached, it follows the underlying.',
  howBonusCap: ', capped at {cap}',

  tplTwinWin: 'Twin win', titlePayoffTwinWin: 'Barriers and redemption',
  bonus: 'Bonus', minRedemption: 'Minimum redemption', upperTouched: 'Upper barrier', lowerTouched: 'Lower barrier', touched: 'Touched on {date}', notTouched: 'Not touched',
  twAboveUpper: 'Above upper barrier', twBelowLower: 'Below lower barrier', participationComponent: 'Performance or bonus',
  twinText: 'At today\'s level the product would repay {total}.',
  howTwinWin: 'Between the {lower} and {upper} barriers, the product turns the underlying\'s performance into a gain whichever way it moves. Outside them, the {bonus} bonus and the {protection} capital protection set the redemption, with at least {min}.',

  tplRate: 'Rate note', titlePayoffRate: 'Coupons and redemption', titleCouponSchedule: 'Coupon schedule',
  fixedCoupon: 'Fixed coupon', floatingCoupon: 'Floating coupon', targetCoupon: 'Target', couponFrequency: 'Coupon frequency', referenceRates: 'Reference rates',
  targetReached: 'Target reached on {date}', targetProgress: 'Coupons paid towards the target',
  colPeriod: 'Period', colRate: 'Rate p.a.', colPeriodCoupon: 'Coupon', colCumulative: 'Cumulative', colStatusShort: 'Status',
  rsPaid: 'Paid', rsUpcoming: 'Upcoming', rsPending: 'To be fixed', rsRedeemed: 'Redeemed', rsCancelled: 'Cancelled'
};

const FR_MORE = {
  noPrice: 'Pas de cours actuel',
  missingPrices: 'Aucun cours actuel n\'était disponible pour {list} lors de l\'évaluation : les valeurs qui en dépendent ne sont pas affichées.',
  barrierAmerican: 'Américaine (en continu)', barrierEuropean: 'Européenne (à l\'observation finale)',
  barrierType: 'Observation de la barrière', barrierLevel: 'Barrière', strikeLevel: 'Strike', participationRate: 'Participation', capitalProtection: 'Protection du capital',
  redemptionValue: 'Remboursement', indicativeRedemption: 'Remboursement indicatif si échéance aujourd\'hui',
  colConsidered: 'Performance retenue', colDistanceLower: 'Distance à la barrière basse',

  tplOrion: 'Orion', titlePayoffOrion: 'Performance et remboursement',
  upperBarrier: 'Barrière haute', rebate: 'Rebate', capitalGuaranteed: 'Capital garanti', lowerBarrier: 'Barrière basse',
  orionCapped: 'Plafonné au rebate', orionParticipating: 'Participe',
  countedPerformances: 'Performances retenues', basketCounted: 'Panier (moyenne retenue)',
  orionNoneHit: 'Aucun sous-jacent n\'a atteint la barrière haute de {upper} : chacun compte pour sa propre performance, et le capital est garanti à {guarantee}.',
  orionSomeHit: '{n} sous-jacents sur {total} ont atteint la barrière haute de {upper} et comptent pour le rebate de {rebate} ; les autres comptent pour leur propre performance. Le capital est garanti à {guarantee}.',
  howOrion: 'Chaque sous-jacent compte pour sa propre performance depuis le lancement, sauf s\'il atteint la barrière haute de {upper} pendant la vie du produit : il compte alors pour un montant fixe de {rebate}. À l\'échéance, le produit rembourse le capital plus la moyenne des performances retenues, et au moins {guarantee} du capital.',

  tplHimalaya: 'Himalaya', titlePayoffHimalaya: 'Sélection et remboursement',
  floor: 'Plancher', averagePerformance: 'Moyenne des performances retenues', payout: 'Remboursement', selectionDone: 'Sous-jacents retenus',
  titleSelection: 'Observations et sélection', colNumber: 'N°', colSelected: 'Sous-jacent retenu', colRemaining: 'Restants',
  selFrozen: 'Retenu', selPending: 'À venir',
  himalayaText: 'La moyenne des performances retenues à ce jour est de {avg} ; avec le plancher de {floor}, le produit verserait {payout}.',
  howHimalaya: 'À chaque date d\'observation, le sous-jacent le plus performant encore dans le panier est retenu avec sa performance puis retiré. À l\'échéance, le produit verse le capital plus la moyenne des performances retenues, avec un plancher de {floor}.',

  tplShark: 'Shark note', titlePayoffShark: 'Barrière et remboursement',
  barrierTouched: 'Barrière haute atteinte', barrierNotTouched: 'Barrière haute non atteinte', touchedOn: 'le {date}',
  sharkText: 'Remboursement à {value}.',
  howShark: 'Si la performance de référence atteint la barrière haute de {upper} pendant la vie du produit, celui-ci rembourse le capital plus un montant fixe de {rebate}. Sinon il rembourse le capital plus la performance à l\'échéance, avec un plancher de {floor}.',

  tplParticipation: 'Note de participation', titlePayoffParticipation: 'Participation et remboursement',
  basketPerformance: 'Performance de référence', participatedPerformance: 'Performance avec participation', protectionLevel: 'Protection', rawRedemption: 'Remboursement avant protection',
  partProtected: 'Avec la participation, le remboursement serait de {raw}, sous la protection de {protection} : le produit rembourse {value}.',
  partNormal: 'Avec la participation, le produit rembourserait {value}.',
  issuerCall: 'Rappel par l\'émetteur', callable: 'Rappelable par l\'émetteur', calledOn: 'Rappelé le {date}', notCalled: 'Non rappelé', callPrice: 'Prix de rappel', noCallOption: 'Pas d\'option de rappel',
  refWorst: 'Moins performant', refBest: 'Plus performant', refAverage: 'Moyenne des sous-jacents', refSingle: 'Sous-jacent unique',
  howParticipation: 'À l\'échéance, le produit rembourse le capital plus {rate} de la performance de référence ({reference}){protection}.',
  howParticipationProtection: ', et au moins {protection} du capital',
  titleCallSchedule: 'Calendrier de rappel', colCallable: 'Rappelable', colRebate: 'Rebate',

  tplReverseConvertible: 'Reverse convertible', titlePayoffRC: 'Coupon et remboursement',
  gearing: 'Effet de levier', capitalComponent: 'Capital remboursé', couponComponent: 'Coupon', barrierBreached: 'La barrière a été franchie',
  rcIntact: 'Les sous-jacents sont au-dessus de la barrière de {barrier} : le capital est intégralement remboursé, plus le coupon.',
  rcBreached: 'Un sous-jacent est sous la barrière de {barrier} : le capital est remboursé à {capital}, plus le coupon.',
  howRC: 'Le produit verse un coupon de {coupon}. À l\'échéance, le capital est intégralement remboursé si aucun sous-jacent n\'est sous la barrière de {barrier} ; sinon le capital suit la baisse du sous-jacent le moins performant.',

  tplReverseConvertibleBond: 'Reverse convertible sur obligation', titlePayoffRCB: 'Strike et remboursement',
  bondLevel: 'Prix de l\'obligation', distanceToStrike: 'Distance au strike', settlement: 'Règlement', settleCash: 'En espèces au pair', settlePhysical: 'Livraison de l\'obligation',
  conversionRatio: 'Ratio de conversion', denomination: 'Valeur nominale',
  strikeAbove: 'Au strike ou au-dessus', strikeBelow: 'Sous le strike',
  rcbCash: 'L\'obligation est au-dessus du strike de {strike} : la note est remboursée au pair en espèces, plus le coupon.',
  rcbPhysical: 'L\'obligation est au strike de {strike} ou en dessous : la note est réglée par livraison de l\'obligation ({ratio} obligations par note), plus le coupon.',
  howRCB: 'La note verse un coupon de {coupon}. À l\'échéance, elle est remboursée au pair en espèces si l\'obligation est au-dessus du strike de {strike} ; au strike ou en dessous, l\'obligation est livrée selon le ratio de conversion.',

  tplBonus: 'Certificat bonus', titlePayoffBonus: 'Barrière et remboursement',
  bonusLevel: 'Niveau bonus', cap: 'Plafond', maxRedemption: 'Remboursement maximum', bonusOrUpside: 'Bonus ou hausse', knockIn: 'Barrière désactivante',
  kiOccurred: 'Barrière franchie le {date}', kiNotYet: 'Observée à l\'observation finale uniquement', kiNone: 'Barrière non franchie à ce jour',
  bonusText: 'Au niveau actuel, le certificat rembourserait {total}.',
  howBonus: 'À l\'échéance, si la barrière de {barrier} n\'a pas été franchie, le certificat rembourse au moins le niveau bonus de {bonus}, plus {rate} de la hausse au-delà{cap}. Si la barrière a été franchie, il suit le sous-jacent.',
  howBonusCap: ', dans la limite de {cap}',

  tplTwinWin: 'Twin win', titlePayoffTwinWin: 'Barrières et remboursement',
  bonus: 'Bonus', minRedemption: 'Remboursement minimum', upperTouched: 'Barrière haute', lowerTouched: 'Barrière basse', touched: 'Atteinte le {date}', notTouched: 'Non atteinte',
  twAboveUpper: 'Au-dessus de la barrière haute', twBelowLower: 'Sous la barrière basse', participationComponent: 'Performance ou bonus',
  twinText: 'Au niveau actuel, le produit rembourserait {total}.',
  howTwinWin: 'Entre les barrières de {lower} et {upper}, le produit transforme la performance du sous-jacent en gain, à la hausse comme à la baisse. Au-delà, le bonus de {bonus} et la protection du capital de {protection} fixent le remboursement, avec au moins {min}.',

  tplRate: 'Note de taux', titlePayoffRate: 'Coupons et remboursement', titleCouponSchedule: 'Calendrier des coupons',
  fixedCoupon: 'Coupon fixe', floatingCoupon: 'Coupon variable', targetCoupon: 'Objectif', couponFrequency: 'Fréquence des coupons', referenceRates: 'Taux de référence',
  targetReached: 'Objectif atteint le {date}', targetProgress: 'Coupons versés vers l\'objectif',
  colPeriod: 'Période', colRate: 'Taux annuel', colPeriodCoupon: 'Coupon', colCumulative: 'Cumul', colStatusShort: 'Statut',
  rsPaid: 'Versé', rsUpcoming: 'À venir', rsPending: 'À fixer', rsRedeemed: 'Remboursé', rsCancelled: 'Annulé'
};

const EN_ALL = { ...EN, ...EN_MORE };
const DICTS = { en: EN_ALL, fr: { ...FR, ...FR_MORE } };

/** Translator for one language: t('key', { var }) with English fallback. */
export const translatorFor = (lang = 'en') => {
  const dict = DICTS[lang] || EN;
  return (key, vars = {}) => {
    const raw = dict[key] ?? EN_ALL[key] ?? key;
    if (typeof raw !== 'string') return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
  };
};

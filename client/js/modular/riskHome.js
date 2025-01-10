import { Template } from 'meteor/templating';
import { Risk } from '/imports/api/products/products.js';
import { Holdings } from '/imports/api/products/products.js';
import moment from 'moment';

function filterRiskData(riskData, userHoldings, userRole) {
  let filteredData;
  if (userRole === 'superAdmin') {
    filteredData = riskData;
  } else {
    const userIsins = userHoldings.map(holding => holding.isin);
    filteredData = riskData.filter(item => userIsins.includes(item.ISINCode));
  }
  // Sort the filtered data by performance, from smaller to bigger
  return filteredData.sort((a, b) => a.performance - b.performance);
}

export function getRiskData(templateInstance) {
  const userRole = templateInstance.userRole.get();
  const riskData = templateInstance.riskData.get();
  const userHoldings = templateInstance.userHoldings.get();

  return filterRiskData(riskData, userHoldings, userRole);
}

export function formatRiskData(data) {
  const now = moment();
  return data.map(item => ({
    ...item,
    daysLeft: moment(item.maturityDate).diff(now, 'days')
  })).sort((a, b) => a.performance - b.performance); // Sort by performance, lowest first
}

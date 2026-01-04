// Simple script to check templateReports collection
// Run with: meteor shell < check-reports.js

const productId = '82LZYkoyWewxw58JT';

// Check if reports exist
console.log('\n=== Checking TemplateReports Collection ===');
Meteor.call('templateReports.getLatest', productId, (err, report) => {
  if (err) {
    console.error('Error fetching report:', err);
  } else if (report) {
    console.log('✅ Found report:');
    console.log('  - Report ID:', report._id);
    console.log('  - Product ID:', report.productId);
    console.log('  - Template ID:', report.templateId);
    console.log('  - Evaluation Date:', report.evaluationDate);
    console.log('  - Created At:', report.createdAt);
  } else {
    console.log('❌ No report found for product:', productId);
  }
});

// Direct collection query
import { TemplateReportsCollection } from '/imports/api/templateReports';
const count = TemplateReportsCollection.find({}).count();
console.log('\nTotal reports in collection:', count);

const reports = TemplateReportsCollection.find({}, { fields: { _id: 1, productId: 1, templateId: 1, createdAt: 1 }, sort: { createdAt: -1 }, limit: 5 }).fetch();
console.log('\nLast 5 reports:');
reports.forEach(r => {
  console.log(`  - ${r._id}: productId=${r.productId}, templateId=${r.templateId}, created=${r.createdAt}`);
});

// Templates Publications
// Handles all template-related publications

// Publish templates for all users
Meteor.publish("templates", async function () {
  const { TemplatesCollection } = require('/imports/api/templates');

  // Debug: Check how many templates exist
  const count = await TemplatesCollection.find({}).countAsync();
  // console.log(`Templates publication: Found ${count} templates in database`);

  return TemplatesCollection.find({}, {
    sort: { name: 1 }
  });
});







import { Template } from 'meteor/templating';

import './mainlayout.html';

Template.mainLayout.events({


  'click #refreshButton'(event) {
    event.preventDefault();  // Prevent default anchor behavior



    Meteor.call('updateAllMarketData', (error, result) => {
      if (error) {
        console.error("Error calling updateAllMarketData:", error);
      } else {
        console.log("Products updated successfully");
console.log(result);



        // Additional success logic
      }
    });
  }
});

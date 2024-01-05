import { Template } from 'meteor/templating';

import './mainlayout.html';

Template.mainLayout.events({


  'click #refreshButton'(event) {
    event.preventDefault();  // Prevent default anchor behavior



    Meteor.call('updateAllProducts', (error, result) => {
      if (error) {
        console.error("Error calling updateAllProducts:", error);
      } else {
        console.log("Products updated successfully");
console.log(result);



        // Additional success logic
      }
    });
  }
});

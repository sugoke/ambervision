Template.dates_reverse_convertible.events({

  'click #check_details'(event) {

    event.preventDefault();
    event.stopPropagation()

    var new_product = {};
    var underlyings = [];
    var features = [];

    $('.underlyings').each(function(i, obj) {

      var idplusone = i + 1

      underlyings[i] = {
        'ticker': obj.value.toUpperCase(),
        'exchange': document.getElementById('country_' + idplusone).value,
        'strike': document.getElementById('strike_' + idplusone).value
      }

    });


    $('.add_field').each(function(i, obj) {

      new_product[obj.id] = obj.value;

    });

    $('.add_checkbox').each(function(i, obj) {

      if (obj.checked) {
        features.push(obj.name)
      }

    });

    console.log(features)
    new_product['features'] = features;
    new_product['underlyings'] = underlyings



    Session.set('summary', new_product)

    console.log(Session.get('summary'))

  },

  'click #launch_date'(event) {

    event.preventDefault();
    event.stopPropagation()

    if (event.currentTarget.value != null) {

      document.getElementById('generate_schedule_reverse_convertible').disabled = false;
    }

  },


});


Template.summary_reverse_convertible.helpers({
  new_product: function() {


    return Session.get('summary')

  },

});

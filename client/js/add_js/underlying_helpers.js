Template.underlyings.events({


  'change .underlyings_change'(event) {
    // Prevent default browser form submit
    event.preventDefault();


    var ticker_id = event.target.id
    var underlying_number = ticker_id.replace(/\D/g, '');

console.log(underlying_number)

    var country = $('#country_' + underlying_number).val()
    var ticker = $('#underlying_' + underlying_number).val()

    var complete_ticker = ticker + '.' + country
    //var td = $('#trade_date_input').val()

    console.log(complete_ticker)


// call method to get last close

    Meteor.call('autofill_underlying_quote', complete_ticker, function(error, result) {
      if (error) {

        $("#close_" + underlying_number).val("Ticker Error")
        //console.warn(error);
      } else {
        $("#close_" + underlying_number).val(result[0].close)
        $("#strike_" + underlying_number).val(result[0].close)
      }
      //console.log(result)

    })

//Call method to get company name
    Meteor.call('autofill_underlying_fund', ticker, function(error, result) {
      if (error) {

        $("#full_name_" + underlying_number).val("Ticker Error")
        //console.warn(error);
      } else {
        $("#full_name_" + underlying_number).val(result)
console.log(result)
      }
      //

    })



  },


});

Template.addproduct.events({

  'click #next_ticker'(event) {
    event.preventDefault();
    event.stopPropagation()
    var numItems = $('.underlyings').length
    numItems++
    console.log(numItems)
    $(".underlyings_input").append('<tr id="underlying_line_' + numItems + '"><th scope="row"><label for=id="underlying_' + numItems + '"  class="mb-2">Ticker</label><div class="input-group"><input type="text" class="form-control underlyings underlyings_change" id=id="underlying_' + numItems + '" placeholder="Ticker" aria-label="Ticker" aria-describedby="basic-addon2"   style="text-transform:uppercase"  autocomplete="off"><div class="input-group-append"><select class="form-select underlyings_change" id="country_' + numItems + '" aria-label="Default select example"><option selected>US</option><option value="1">FR</option><option value="2">DE</option></select></div></div></th><td><label for="close_1"  class="mb-2">Close ({{td}})</label><input type="text" class="form-control cash" id="close_' + numItems + '" value="" disabled></td><td><label for="strike_1"  class="mb-2">Strike</label><input type="text" class="form-control cash" id="strike_' + numItems + '" value=""  autocomplete="off"></td><td><label for="remove_underlying_' + numItems + ' "  class="mb-2">Del.</label><button class="btn btn-outline-theme form-control" type="button" id="remove_underlying_' + numItems + ' " onclick="$(this).parent().parent().remove();">X</button></td></tr>');

    cash_mask_id('strike_' + numItems);

  },

  'click #generateschedule'(event) {

    event.preventDefault();
    event.stopPropagation()

    moment = require('moment');
    moment.locale('en-gb')

    //Remplissage des 5 cases relatives aux dates

    var lag = document.getElementById('pmt_lag').value;

    var duration = document.getElementById('duration').value;
    var duration_unit = document.getElementById('duration_unit').value;

    var tradedate = document.getElementById('launchdate').value;
    var tradepaymentdate = moment(tradedate, 'DD/MM/YYYY').add(lag, 'days').format('DD/MM/YYYY');

    var finaldate = moment(tradedate, 'DD/MM/YYYY').add(duration, duration_unit).format('DD/MM/YYYY');

    var finalpaymentdate = moment(finaldate, 'DD/MM/YYYY').add(lag, 'days').format('DD/MM/YYYY');

    var duration_nc = document.getElementById('duration_nc').value;
    var duration_unit_nc = document.getElementById('duration_unit_nc').value;

    var first_call_date = moment(tradedate, 'DD/MM/YYYY').add(duration_nc, duration_unit_nc).format('DD/MM/YYYY');


    document.getElementById('tradedate').value = tradedate;
    document.getElementById('tradepaymentdate').value = tradepaymentdate;
    document.getElementById('finaldate').value = finaldate;
    document.getElementById('finalpaymentdate').value = finalpaymentdate;
    document.getElementById('firstcalldate').value = first_call_date;

    //Fin remplissage 5 cases relatives aux dates

    //Maintenant on doit générer le tableau de toutes les observation_dates

    Session.set('observation_dates', null) //création de l'objet observation_dates

    setTimeout(function() {


      var productType = document.getElementById('product_type_input').value;

      var noncall_duration = document.getElementById('duration_nc').value;
      var noncall_unit = document.getElementById('duration_unit_nc').value;
      var first_call_date = moment(tradedate, 'DD/MM/YYYY').add(noncall_duration, noncall_unit).format('DD/MM/YYYY');

      var autocall_base_level = parseFloat(document.getElementById('autocall_barrier_input').value) / 100;
      var protection_barrier = Number(document.getElementById('protection_barrier_input').value);
      var stepdown = document.getElementById('step_down').checked;
      var non_call = document.getElementById('step_down').checked;
      var periodicity = document.getElementById('periodicity').value;

      if (stepdown) {
        var stepdown_after = document.getElementById('stepdown_input').value;
        var shift = parseFloat(document.getElementById('shift_input').value) / 100;

        var start_sd = adjusted_date(date_start_sd(stepdown_after, trade_date))
      }

    }, 50);


  },

  'click #generate_schedule_reverse_convertible'(event) {

    event.preventDefault();
    event.stopPropagation()

    moment = require('moment');
    moment.locale('en-gb')

    //Remplissage des 5 cases relatives aux dates

    var lag = document.getElementById('pmt_lag').value;

    var duration = document.getElementById('duration').value;
    var duration_unit = document.getElementById('duration_unit').value;

    var tradedate = document.getElementById('launch_date').value;
    var tradepaymentdate = moment(tradedate, 'DD/MM/YYYY').add(lag, 'days').format('DD/MM/YYYY');

    var finaldate = moment(tradedate, 'DD/MM/YYYY').add(duration, duration_unit).format('DD/MM/YYYY');

    var finalpaymentdate = moment(finaldate, 'DD/MM/YYYY').add(lag, 'days').format('DD/MM/YYYY');





    document.getElementById('trade_date').value = tradedate;
    document.getElementById('trade_payment_date').value = tradepaymentdate;
    document.getElementById('final_date').value = finaldate;
    document.getElementById('final_payment_date').value = finalpaymentdate;


    //Fin remplissage 5 cases relatives aux dates

    //Maintenant on doit générer le tableau de toutes les observation_dates

  },

  'click #insert_product'(event) {
    event.preventDefault();
    event.stopPropagation()




  },

});

/////////////////////////////////////////////////////////////////////////////////////

Template.addproduct.onRendered(function() {

  percent_mask();
  cash_mask();




  setTimeout(function() {

    $('.datepick').datepicker({
      autoclose: true,
      todayHighlight: true,
      format: "dd/mm/yyyy",
      orientation: "bottom left"
    });


  }, 1000);




});

/////////////////////////////////////////////////////////////////////////////////////

Template.addproduct.helpers({
  product_type: function() {

    if (Router.current().params.query.type == "reverse_convertible") {
      return "Reverse Convertible"
    }
  },

  product_summary: function() {

    if (Router.current().params.query.type == "reverse_convertible") {
      return "Reverse Convertible"
    }
  },

});

//////////////////////////////////////////////////////////////////////////////////////
Template.addproduct.events({
  'keyup #isin_input': function(event) { //check if ISIN is valid

    var isin = event.currentTarget.value

    if (isin.length != 12) {
      $("#isin_input").removeClass("is-valid");
      $("#isin_input").addClass("is-invalid");
      return false;
    }
    var v = [];
    for (var i = isin.length - 2; i >= 0; i--) {
      var c = isin.charAt(i);
      if (isNaN(c)) { //not a digit
        var letterCode = isin.charCodeAt(i) - 55; //Char ordinal + 9
        v.push(letterCode % 10);
        if (letterCode > 9) {
          v.push(Math.floor(letterCode / 10));
        }
      } else {
        v.push(Number(c));
      }
    }
    var sum = 0;
    var l = v.length;
    for (var i = 0; i < l; i++) {
      if (i % 2 == 0) {
        var d = v[i] * 2;
        sum += Math.floor(d / 10);
        sum += d % 10;
      } else {
        sum += v[i];
      }
    }


    if (((10 - (sum % 10)) % 10) === Number(isin.charAt(11))) {

      $("#isin_input").removeClass("is-invalid");
      $("#isin_input").addClass("is-valid");

      return true;
    } else {
      $("#isin_input").removeClass("is-valid");
      $("#isin_input").addClass("is-invalid");
      return false
    }

  },

  //check all required fields are ok

  'change .required': function(event) {

    $('.required').each(function(i, div) {

      console.log(i)

    })

  }


});

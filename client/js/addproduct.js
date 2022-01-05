Template.addproduct.events({

'click #next_ticker'(event) {
  event.preventDefault();
  event.stopPropagation()
  var numItems = $('.underlyings').length
  numItems++
  console.log(numItems)
  $(".underlyings_input").append('<tr id="underlying_line_' + numItems + '"><th scope="row"><label for=id="underlying_' + numItems + '"  class="mb-2">Ticker</label><div class="input-group"><input type="text" class="form-control underlyings underlyings_change" id=id="underlying_' + numItems + '" placeholder="Ticker" aria-label="Ticker" aria-describedby="basic-addon2"  autocomplete="off"><div class="input-group-append"><select class="form-select underlyings_change" id="country_' + numItems + '" aria-label="Default select example"><option selected>US</option><option value="1">FR</option><option value="2">DE</option></select></div></div></th><td><label for="close_1"  class="mb-2">Close ({{td}})</label><input type="text" class="form-control cash" id="close_' + numItems + '" value="" disabled></td><td><label for="strike_1"  class="mb-2">Strike</label><input type="text" class="form-control cash" id="strike_' + numItems + '" value=""  autocomplete="off"></td><td><label for="remove_underlying_' + numItems + ' "  class="mb-2">Del.</label><button class="btn btn-outline-theme form-control" type="button" id="remove_underlying_' + numItems + ' " onclick="$(this).parent().parent().remove();">X</button></td></tr>');

  //cash_mask_id('strike_' + numItems);

},

'click #generateschedule'(event) {

  event.preventDefault();
  event.stopPropagation()

  moment = require('moment');
  moment.locale('en-gb')

//Remplissage des 5 cases relatives aux dates

  var lag = document.getElementById('pmtlag').value;

  var duration = document.getElementById('duration').value;
  var duration_unit =  document.getElementById('duration_unit').value;

  var tradedate = document.getElementById('launchdate').value;
  var tradepaymentdate = moment(tradedate, 'DD/MM/YYYY').add(7, 'days').format('DD/MM/YYYY');

  var finaldate = moment(tradedate, 'DD/MM/YYYY').add(duration, duration_unit).format('DD/MM/YYYY');

  var finalpaymentdate = moment(finaldate, 'DD/MM/YYYY').add(7, 'days').format('DD/MM/YYYY');

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

Session.set('observation_dates', null)   //création de l'objet observation_dates

setTimeout(function() {


  var productType = document.getElementById('product_type_input').value;

  var noncall_duration = document.getElementById('duration_nc').value; var noncall_unit = document.getElementById('duration_unit_nc').value;
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

});


Template.addproduct.onRendered(function() {

  setTimeout(function(){

    $('.datepick').datepicker({
      autoclose: true,
      todayHighlight: true,
      format: "dd/mm/yyyy",
      orientation: "bottom left"
    });


   }, 1000);




});

Template.addproduct.helpers({
  product_type: function(){

    if (Router.current().params.query.type == "reverse_convertible") {return "Reverse Convertible"}

  }
});

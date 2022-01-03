Template.addproduct.events({

'click #next_ticker'(event) {
  event.preventDefault();
  event.stopPropagation()
  var numItems = $('.underlyings').length
  numItems++
  console.log(numItems)
  $(".underlyings_input").append('<tr id="underlying_line_' + numItems + '"><th scope="row"><label for=id="underlying_' + numItems + '"  class="mb-2">Ticker</label><div class="input-group"><input type="text" class="form-control underlyings underlyings_change" id=id="underlying_' + numItems + '" placeholder="Ticker" aria-label="Ticker" aria-describedby="basic-addon2"><div class="input-group-append"><select class="form-select underlyings_change" id="country_' + numItems + '" aria-label="Default select example"><option selected>US</option><option value="1">FR</option><option value="2">DE</option></select></div></div></th><td><label for="close_1"  class="mb-2">Close ({{td}})</label><input type="text" class="form-control cash" id="close_' + numItems + '" value="" disabled></td><td><label for="strike_1"  class="mb-2">Strike</label><input type="text" class="form-control cash" id="strike_' + numItems + '" value=""></td><td><label for="remove_underlying_' + numItems + ' "  class="mb-2">Del.</label><button class="btn btn-outline-theme form-control" type="button" id="remove_underlying_' + numItems + ' " onclick="$(this).parent().parent().remove();">X</button></td></tr>');

  //cash_mask_id('strike_' + numItems);

},

});


Template.addproduct.onRendered(function() {

  setTimeout(function(){

    $('.datepick').datepicker({
      autoclose: true,
      todayHighlight: true,
      orientation: "bottom left"
    });


   }, 1000);




});

percent_mask = function(){

  const Autonumeric = require('autonumeric')
  new Autonumeric.multiple('.percent','percentageEU2dec',{ currencySymbol:"%", currencySymbolPlacement:"s"});


};

percent_mask = function(){

  const Autonumeric = require('autonumeric')
  new Autonumeric.multiple('.percent','percentageEU2dec',{ currencySymbol:"%", currencySymbolPlacement:"s"});


};

percent_mask_id = function(item){

  const Autonumeric = require('autonumeric')
  new Autonumeric('#'+item,'percentageEU2dec');


};

cash_mask = function(item){

  const Autonumeric = require('autonumeric')
  new Autonumeric.multiple('.cash');


};

cash_mask_id = function(item){

  const Autonumeric = require('autonumeric')
  new Autonumeric('#'+item);


};

refresh_rc = function(isin) {


  const percentage = require ('percentage')
  var product_details = {}

  var current_product = Products.findOne({
    isin_input: isin
  })

// write last bid and date in the BDD

      product_details.last_bid = 99,
      product_details.bid_date = '2022-02-03'

  Products.update({isin_input: isin}, {$set: {product_details: product_details} })

// Analyse des sous-jacents, perf et distance et ajout dans la BDD


  for (let i = 0; i < current_product.underlyings.length; i++) {

    var last_quote = historical_data.find({ticker:current_product.underlyings[i].ticker+'.'+current_product.underlyings[i].exchange}).fetch()[0].data[0]
    var last_close = last_quote.close
    var last_close_date = last_quote.date
    var strike = current_product.underlyings[i].strike

    var protection_barrier = parseFloat(current_product.protection_barrier,2)/100* strike

    var perf = ((last_close / strike) - 1)
    var perf = percentage(perf,2)

    var distance = (last_close - protection_barrier ) / last_close
    var distance = percentage(distance,2)


    console.log(last_close)


  Products.update({isin_input: isin}, {$set:{
      "underlyings.$[elem].last_close" : last_close,
      "underlyings.$[elem].date_last_close" : last_close_date,
      "underlyings.$[elem].perf" : perf,
      "underlyings.$[elem].distance" : distance,

  }}, {
      "arrayFilters": [
        {"elem.ticker" : current_product.underlyings[i].ticker,
        "elem.exchange" : current_product.underlyings[i].exchange,
      }
      ]
  })


  }

// On crée les données du chart
var trade_date = current_product.trade_date;
var final_date = current_product.final_date;

//var ticker = current_product.underlyings[i].ticker;
//var country = current_product.underlyings[i].country;
//var complete_ticker = ticker+'.'+country


// create labels for the chart
var labels = getDates(trade_date,final_date)

console.log(labels)

Products.update({isin_input: isin}, {$set: {'chart.labels': labels} })

/*
  for (let j = 0; j < current_product.underlyings.length; j++) {

    var temp = historical_data.findOne({ticker: complete_ticker})

    console.log(temp)

  }
*/
}

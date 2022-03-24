refresh_rc = function(isin) {

  var product_details = []

  var current_product = Products.findOne({
    isin_input: isin
  })

  product_details.push(

    {
      last_bid: '99%',
      bid_date: '2022-02-03'
    }

  )

  Products.update({isin_input: isin}, {$set: {product_details: product_details} })


  for (let i = 0; i < current_product.underlyings.length; i++) {

    var last_quote = historical_data.find({ticker:current_product.underlyings[i].ticker+'.'+current_product.underlyings[i].exchange}).fetch()[0].data[0]
    var last_close = last_quote.close
    var last_close_date = last_quote.date


    console.log(last_close)


  Products.update({isin_input: isin}, {$set:{
      "underlyings.$[elem].last_close" : last_close,
      "underlyings.$[elem].date_last_close" : last_close_date,
  }}, {
      "arrayFilters": [
        {"elem.ticker" : current_product.underlyings[i].ticker,
        "elem.exchange" : current_product.underlyings[i].exchange,
      }
      ]
  })


  }

}

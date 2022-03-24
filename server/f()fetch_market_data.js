fetch_market_data = function() {

  return new Promise(function(resolve, reject)
  {


var moment = require('moment-business-days');
var today = moment().format('YYYY-MM-DD')

var product_db = Products.find().fetch();  //on récupère tous les produits
var all_tickers = []
var full_historical = []

historical_data.remove({});  // on vide la collection des données marché

////////// On crée un array avec tous les stocks

for (let i = 0; i < product_db.length; i++) {

  for (let j = 0; j < product_db[i].underlyings.length; j++) {

    var full_ticker = product_db[i].underlyings[j].ticker + '.' + product_db[i].underlyings[j].exchange

    all_tickers.push(full_ticker)

  }

}

var all_tickers_unique = all_tickers.filter(function(item, pos) {
  return all_tickers.indexOf(item) == pos;
})

//console.log(all_tickers_unique) // Array avec tous les underlyings sans doublon

/////////////////////////////////////////////////

const axios = require('axios').default;

const promises = [];

for (let j = 0; j < all_tickers_unique.length; j++) {


  promises.push(

    axios.get(

      'https://eodhistoricaldata.com/api/eod/' + all_tickers_unique[j], {
        params: {
          api_token: '5c265eab2c9066.19444326',
          from: '2021-01-01',
          to: today,
          fmt: 'json',
          order: 'd'
        }
      }
    )
    .then(function(response) {
      // handle success
      historical_data.insert({
        ticker: all_tickers_unique[j],
        data: response.data
      })

    })
    .catch(function(error) {
      // handle error
      console.log(error);
    })

  )

}

// Si besoin de faire quelque chose quand toutes les données sont mises dans la DB
Promise.all(promises)
  .then(() => {

resolve(product_db)

  })
  .catch((e) => {
    // handle errors here
  });


  });

}

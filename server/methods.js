Meteor.methods({


  'insert_product'(summary) {

    Products.insert(summary);

  },


  'refresh_all'() {

    fetch_market_data = fetch_market_data() //on update la DB des market data pour tous les underlyings jusqu'à aujourd'hui

    fetch_market_data.then(function(response) {
        // handle success
        console.log(response);

        var product_db = response

        for (let i = 0; i < product_db.length; i++) {

          var type = product_db[i].type

          if (type == "Reverse convertible") {

            refresh_rc(product_db[i].isin_input)


          }

        }

      })
      .catch(function(error) {
        // handle error
        console.log(error);
      })

  },

  'autofill_underlying_quote': async function(ticker) {

    var moment = require('moment-business-days');
    var today = moment().format('YYYY-MM-DD')
    var yesterday = moment().subtract(4, 'd').format('YYYY-MM-DD');


    const axios = require('axios').default;

    const url = ticker


    try {
      return await axios.get('https://eodhistoricaldata.com/api/eod/' + ticker, {
        params: {
          api_token: '5c265eab2c9066.19444326',
          from: yesterday,
          to: today,
          fmt: 'json',
          order: 'd'
        }
      }).then(content => content.data);

    } catch (error) {
      throw {
        code: error.code,
        message: error.message,
        responseStatus: error.response?.status
      };
    }

  },

  'autofill_underlying_fund': async function(ticker, country) {

    const axios = require('axios').default;

    try {
      return await axios.get('http://api.marketstack.com/v1/tickers/' + ticker + '?access_key=8c5e76141b1ea5c9ef3239d0d126e2d6', {

      }).then(function(response) {
        // handle success


        console.log(response.data.name)

        return response.data.name
      })

    } catch (error) {

    }

  },


});

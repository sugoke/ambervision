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

  }


});

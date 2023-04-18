Template.product_details_reverse_convertible.helpers({

  current_product: function() {


    return Products.findOne({
      isin_input: 'XS9879879872'
    });
  },


});



Template.product_details_reverse_convertible.onRendered(function() {

  var Chart = require('chart.js');
  //var ChartAnnotation = require('chartjs-plugin-annotation');

  this.autorun(() => {

          var datasets = [{
            color: COLOR_THEME,
            backgroundColor: hexToRgba(COLOR_THEME, .2),
            borderColor: COLOR_THEME,
            borderWidth: 1.5,
            pointBackgroundColor: COLOR_WHITE,
            pointBorderWidth: 1.5,
            pointRadius: 4,
            pointHoverBackgroundColor: COLOR_THEME,
            pointHoverBorderColor: COLOR_WHITE,
            pointHoverRadius: 7,
            label: 'TSLA',
            data: [100, 96,120,110,117,92,102]
          }]



              datasets.push({
                  data: [70, 70, 70, 70, 70, 70, 70],
                  label: "Protection barrier",
                  borderColor: COLOR_RED,
                  fill: true
                }, {
                  data: [80, 80, 80, 80, 80, 80, 80, ],
                  label: "Worst-of",
                  borderColor: COLOR_GRAY,
                  fill: false,
                  borderWidth: 6,
                  order: 0
                }, {
                  data: [100, 100,100,100,100,100,100,100,],
                  label: "Autocall level",
                  borderColor: COLOR_CYAN,
                  fill: true,
                  borderWidth: 3,
                  order: 0,
                },

              )


    product_data = Products.findOne({
      isin_input: "XS9879879872"
      //isin: Router.current().params.query.isin
    })

    console.log(product_data)

    var ctx = document.getElementById("rc_chart").getContext("2d");
    var rc_chart = new Chart(ctx, {
      type: 'line',



      data: {
        labels: ['01-01-2021','01-02-2021','01-03-2021','01-04-2021','01-05-2021','01-06-2021','01-07-2021',],
        datasets: datasets,

      },


              options: {

                responsive: true,

                scales: {
                  xAxes: [{

                    stacked: true,
                    ticks: {
                      align: 'center',
                      maxRotation: 0,
                      autoSkip: false,
                      fontColor: '#000000',

                    },

                    gridLines: {
                      drawOnChartArea: false,
                      display: false
                    }
                  }],
                  yAxes: [{
                    gridLines: {
                      drawOnChartArea: true
                    }
                  }],

                },


                title: {
                  display: true,
                  text: 'Evolution of the underlyings since inception'
                },

                ////array_labels

                plugins: {
                  datalabels: {
                    align: function(context) {

                    },
                    anchor: 'end',
                    backgroundColor: null,
                    borderColor: null,
                    borderRadius: 4,
                    borderWidth: 1,
                    color: '#223388',
                    font: {
                      size: 11,
                      weight: 600
                    },
                    offset: 4,
                    padding: 0,
                    formatter: function(value, context) {


                    }
                  }
                }


                ////
              }

    });



    rc_chart.update();

  })

});

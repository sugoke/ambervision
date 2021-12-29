
Router.configure({
    layoutTemplate: 'layout'
});


Router.route('/myunderlyings', function () {
  this.render('myunderlyings');
});


Router.route('/productdetail', function () {
  this.render('productdetail');
});

Router.route('/productlist', function () {
  this.render('productlist');
});


Router.route('/calendar', function () {
  this.render('calendar');
});

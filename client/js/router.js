
Router.configure({
    layoutTemplate: 'layout'
});

Router.route('/', function () {
  this.render('home');
});


Router.route('/productdetail', function () {
  this.render('productdetail');
});

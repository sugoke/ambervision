Router.configure({
  layoutTemplate: 'layout'
});


Router.route('/', function() {
  this.render('dashboard');
});

Router.route('/myunderlyings', function() {
  this.render('myunderlyings');
});


Router.route('/productdetail', function() {
  this.render('productdetail');
});

Router.route('/productlist', function() {
  this.render('productlist');
});


Router.route('/calendar', function() {
  this.render('calendar');
});

Router.route('/addproduct', function() {
  this.render('addproduct');
});

Router.route('/trackrecord', function() {
  this.render('trackrecord');
});

Router.route('login', {
  layoutTemplate: '' //set the layout template to null
});


Router.route('register', {
  layoutTemplate: '' //set the layout template to null
});

Router.route('/product_details_reverse_convertible', function() {
  this.render('product_details_reverse_convertible');
});

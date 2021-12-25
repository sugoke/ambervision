
Router.configure({
    layoutTemplate: 'layout'
});




Router.route('/productdetail', function () {
  this.render('productdetail');
});

Router.route('/productlist', function () {
  this.render('productlist');
});

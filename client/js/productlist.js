dataTableData = function () {
    return ['Apple', 'Banana']
};

Template.productlist.helpers({
    reactiveDataFunction: function () {
        return dataTableData;
    },
    optionsObject: optionsObject // see below
});

var optionsObject = {
    columns: [{
        title: 'Real Name',
        data: 'profile.realname', // note: access nested data like this
        className: 'nameColumn'
    }, {
        title: 'Photo',
        data: 'profile.picture',
      //  render: renderPhoto, // optional data transform, see below
        className: 'imageColumn'
    }],
    // ... see jquery.dataTables docs for more
}

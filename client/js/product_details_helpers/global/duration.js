unit_duration = function(duration) {

  var unit = duration.substr(duration.length - 1);

  if (unit == "M") {
    return "months"
  } else if (unit == "Y") {
    return 'years'
  }

}

/////////////////////////////////////////////////////////////////////////////

nb_duration = function(duration) {
  return duration.substring(0, duration.length - 1);
}

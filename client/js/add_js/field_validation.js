
getVerificationCode = function(isin) {

  if (isin.length != 12) return false;
  var v = [];
  for (var i = isin.length - 2; i >= 0; i--) {
      var c = isin.charAt(i);
      if (isNaN(c)) { //not a digit
          var letterCode = isin.charCodeAt(i) - 55; //Char ordinal + 9
          v.push(letterCode % 10);
          if (letterCode > 9) {
              v.push(Math.floor(letterCode / 10));
          }
      } else {
          v.push(Number(c));
      }
  }
  var sum = 0;
  var l = v.length;
  for (var i = 0; i < l; i++) {
      if (i % 2 == 0) {
          var d = v[i] * 2;
          sum += Math.floor(d / 10);
          sum += d % 10;
      } else {
          sum += v[i];
      }
  }


  if (((10 - (sum % 10)) % 10) === Number(isin.charAt(11))) {
         return true;
     }
     return false;


}

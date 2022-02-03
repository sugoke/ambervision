import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';

import './main.html';
import { Chart } from 'chart.js'
//import { DataTables } from 'datatables.net'


import {
  moment
} from 'moment';

import 'moment/locale/en-gb';

//import 'moment/locale/es'  // without this line it didn't work
//moment.locale('es')

import {
  holidays
} from 'moment-business-days'

import AutoNumeric from 'autonumeric';

/* --------------------
 * got-resume module
 * ------------------*/

'use strict';

// Imports
const gotResume = require('./stream'),
	errors = require('./errors'),
	Transfer = require('./transfer');

// Exports
module.exports = Object.assign(gotResume, { Transfer }, errors);

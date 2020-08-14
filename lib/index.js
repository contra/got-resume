const gotResume = require('./stream')
const errors = require('./errors')
const Transfer = require('./transfer')

module.exports = Object.assign(gotResume, { Transfer }, errors)

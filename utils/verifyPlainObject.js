const isPlainObject = require('lodash/isPlainObject')
const warning = require('./warning')

module.exports = function verifyPlainObject(value, displayName, methodName) {
  if (!isPlainObject(value)) {
    warning(
      `${methodName}() in ${displayName} must return a plain object. Instead received ${value}.`
    )
  }
}

const { bindActionCreators } = require('redux')

module.exports = function wrapActionCreators(actionCreators) {
  return dispatch => bindActionCreators(actionCreators, dispatch)
}

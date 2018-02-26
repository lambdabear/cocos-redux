const { wrapMapToPropsConstant, wrapMapToPropsFunc } = require('./wrapMapToProps')

function whenMapStateToPropsIsFunction(mapStateToProps) {
  return (typeof mapStateToProps === 'function')
    ? wrapMapToPropsFunc(mapStateToProps, 'mapStateToProps')
    : undefined
}

function whenMapStateToPropsIsMissing(mapStateToProps) {
  return (!mapStateToProps)
    ? wrapMapToPropsConstant(() => ({}))
    : undefined
}

module.exports = [
  whenMapStateToPropsIsFunction,
  whenMapStateToPropsIsMissing
]

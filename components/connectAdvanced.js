const invariant = require('invariant')
const Subscription = require('../utils/Subscription')

let hotReloadingVersion = 0
const dummyState = {}
function noop() { }
function makeSelectorStateful(sourceSelector, store) {
  // wrap the selector in an object that tracks its results between runs.
  const selector = {
    run: function runComponentSelector(props) {
      // console.log(props)
      try {
        const nextProps = sourceSelector(store.getState(), props)
        // console.log(nextProps)
        if (nextProps !== selector.props || selector.error) {
          selector.shouldComponentUpdate = true
          selector.props = nextProps
          selector.error = null
        }
      } catch (error) {
        selector.shouldComponentUpdate = true
        selector.error = error
        console.log(error)
      }
    }
  }

  return selector
}

module.exports.connectAdvanced = function (
  /*
    selectorFactory is a func that is responsible for returning the selector function used to
    compute new props from state, props, and dispatch. For example:

      export default connectAdvanced((dispatch, options) => (state, props) => ({
        thing: state.things[props.thingId],
        saveThing: fields => dispatch(actionCreators.saveThing(props.thingId, fields)),
      }))(YourComponent)

    Access to dispatch is provided to the factory so selectorFactories can bind actionCreators
    outside of their selector as an optimization. Options passed to connectAdvanced are passed to
    the selectorFactory, along with displayName and wrappedObject, as the second argument.

    Note that selectorFactory is responsible for all caching/memoization of inbound and outbound
    props. Do not use connectAdvanced directly without memoizing results between calls to your
    selector, otherwise the Connect component will re-render on every state or props change.
  */

  //  NEW: for cocos-redux
  store,

  selectorFactory,
  // options object:
  {
    // the func used to compute this HOC's displayName from the wrapped component's displayName.
    // probably overridden by wrapper functions such as connect()
    getDisplayName = name => `ConnectAdvanced(${name})`,

    // shown in error messages
    // probably overridden by wrapper functions such as connect()
    methodName = 'connectAdvanced',

    // if defined, the name of the property passed to the wrapped element indicating the number of
    // calls to render. useful for watching in react devtools for unnecessary re-renders.
    renderCountProp = undefined,

    // determines whether this HOC subscribes to store changes
    shouldHandleStateChanges = true,

    // the key of props/context to get the store
    storeKey = 'store',

    // if true, the wrapped element is exposed by this HOC via the getWrappedInstance() function.
    withRef = false,

    // additional options are passed through to the selectorFactory
    ...connectOptions
  } = {}
) {
  const UPDATERKEY = '_updater'

  const subscriptionKey = storeKey + 'Subscription'
  const version = hotReloadingVersion++

  return function wrapWithConnect(wrappedObject) {
    invariant(
      typeof wrappedObject == 'object',
      `You must pass a component to the function returned by ` +
      `${methodName}. Instead received ${JSON.stringify(wrappedObject)}`
    )

    const wrappedObjectName = wrappedObject.properties.name
      || wrappedObject.name
      || 'prototypeObject'

    const displayName = getDisplayName(wrappedObjectName)

    const selectorFactoryOptions = {
      ...connectOptions,
      getDisplayName,
      methodName,
      renderCountProp,
      shouldHandleStateChanges,
      storeKey,
      withRef,
      displayName,
      // wrappedObjectName,
      wrappedObject
    }

    const connect = {
      ...wrappedObject,

      properties: {
        ...wrappedObject.properties,
        __version: "",
        __state: null,
        __renderCount: 0,
        __store: null,
        props: null,
        __selector: null,
        __subscription: null,
        __notifyNestedSubs: null
      }

      onLoad: function () {
        if (wrappedObject.onLoad) wrappedObject.onLoad.call(this)
        this.__version = version
        this.__state = {}
        this.__renderCount = 0
        this.__store = store

        // this.__setWrappedInstance = this.__setWrappedInstance.bind(this)

        invariant(this.__store,
          `Could not find "${storeKey}" in either the context or props of ` +
          `"${displayName}". Either wrap the root component in a <Provider>, ` +
          `or explicitly pass "${storeKey}" as a prop to "${displayName}".`
        )

        this.__initSelector()
        this.__initSubscription()
      },

      start: function () {
        if (shouldHandleStateChanges) {
          this.__subscription.trySubscribe()
          this.__selector.run(this.props)
          if (this.__selector.shouldComponentUpdate) {
            this.props = this.__selector.props
            // this[UPDATERKEY]()
            // this.__selector.shouldComponentUpdate = false
          }
        }

        if (wrappedObject.start) wrappedObject.start.call(this)
      },

      onDestroy() {
        if (wrappedObject.onDestroy) wrappedObject.onDestroy.call(this)
        if (this.__subscription) this.__subscription.tryUnsubscribe()
        this.__subscription = null
        this.__notifyNestedSubs = noop
        this.__store = null
        this.props = null
        this.__selector.run = noop
        this.__selector.shouldComponentUpdate = false
      },

      __initSelector() {
        const sourceSelector = selectorFactory(store.dispatch, selectorFactoryOptions)
        this.__selector = makeSelectorStateful(sourceSelector, this.__store)
        this.__selector.run(this.props)
        this.props = this.__selector.props
      },

      __initSubscription() {
        if (!shouldHandleStateChanges) return

        // parentSub's source should match where store came from: props vs. context. A component
        // connected to the store via props shouldn't use subscription from context, or vice versa.
        // const parentSub = (this.propsMode ? this.props : this.context)[subscriptionKey]
        this.__subscription = new Subscription(this.__store, null, this.__onStateChange.bind(this))

        // `notifyNestedSubs` is duplicated to handle the case where the component is  unmounted in
        // the middle of the notification loop, where `this.subscription` will then be null. An
        // extra null check every change can be avoided by copying the method onto `this` and then
        // replacing it with a no-op on unmount. This can probably be avoided if Subscription's
        // listeners logic is changed to not call listeners that have been unsubscribed in the
        // middle of the notification loop.
        // this.__notifyNestedSubs = this.subscription.notifyNestedSubs.bind(this.__subscription)
      },

      __onStateChange() {
        const selector = this.__selector
        selector.run(this.props)

        if (selector.error) {
          throw selector.error
        }

        if (selector.shouldComponentUpdate) {
          this.props = this.__selector.props
          // console.log(this.props)
          if (typeof this[UPDATERKEY] === 'function') {
            this[UPDATERKEY]()
          }
          selector.shouldComponentUpdate = false
        }
      },

      __isSubscribed() {
        return Boolean(this.__subscription) && this.__subscription.isSubscribed()
      },
    }
    return connect
  }
}

// import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'
// import { Component, createElement } from 'react'

import Subscription from '../utils/Subscription'
// import { storeShape, subscriptionShape } from '../utils/PropTypes'

let hotReloadingVersion = 0
const dummyState = {}
function noop() { }
function makeSelectorStateful(sourceSelector, store) {
  // wrap the selector in an object that tracks its results between runs.
  const selector = {
    run: function runComponentSelector(props) {
      try {
        const nextProps = sourceSelector(store.getState(), props)
        if (nextProps !== selector.props || selector.error) {
          selector.shouldComponentUpdate = true
          selector.props = nextProps
          selector.error = null
        }
      } catch (error) {
        selector.shouldComponentUpdate = true
        selector.error = error
      }
    }
  }

  return selector
}

export default function connectAdvanced(
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

  //  NEW:
  store,
  //
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

  // const contextTypes = {
  //   [storeKey]: storeShape,
  //   [subscriptionKey]: subscriptionShape,
  // }
  // const childContextTypes = {
  //   [subscriptionKey]: subscriptionShape,
  // }

  return function wrapWithConnect(wrappedObject) {
    invariant(
      typeof wrappedObject == 'object',
      `You must pass a component to the function returned by ` +
      `${methodName}. Instead received ${JSON.stringify(wrappedObject)}`
    )

    const wrappedObjectName = wrappedObject.displayName
      || wrappedObject.name
      || 'Component'

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
      wrappedObjectName,
      wrappedObject
    }

    const connect = {
      ...wrappedObject,
      onLoad: function () {
        if (wrappedObject.onLoad) wrappedObject.onLoad()

        this.__version = version
        this.__state = {}
        this.__renderCount = 0
        this.__store = store

        this.__setWrappedInstance = this.__setWrappedInstance.bind(this)

        invariant(this.__store,
          `Could not find "${storeKey}" in either the context or props of ` +
          `"${displayName}". Either wrap the root component in a <Provider>, ` +
          `or explicitly pass "${storeKey}" as a prop to "${displayName}".`
        )

        this.props = {}
        this.__initSelector()
        this.__initSubscription()
      },

      start: function () {
        if (wrappedObject.start) wrappedObject.start()
        if (!shouldHandleStateChanges) return

        // componentWillMount fires during server side rendering, but componentDidMount and
        // componentWillUnmount do not. Because of this, trySubscribe happens during ...didMount.
        // Otherwise, unsubscription would never take place during SSR, causing a memory leak.
        // To handle the case where a child component may have triggered a state change by
        // dispatching an action in its componentWillMount, we have to re-run the select and maybe
        // re-render.
        this.__subscription.trySubscribe()
        this.__selector.run(this.props)
        if (this.__selector.shouldComponentUpdate) this[UPDATERKEY]()
      },

      componentWillReceiveProps(nextProps) {
        this.__selector.run(nextProps)
      },

      shouldComponentUpdate() {
        return this.__selector.shouldComponentUpdate
      },

      onDestroy() {
        if (this.__subscription) this.__subscription.tryUnsubscribe()
        this.__subscription = null
        this.__notifyNestedSubs = noop
        this.__store = null
        this.__selector.run = noop
        this.__selector.shouldComponentUpdate = false
      },

      __getWrappedInstance() {
        invariant(withRef,
          `To access the wrapped instance, you need to specify ` +
          `{ withRef: true } in the options argument of the ${methodName}() call.`
        )
        return this.__wrappedInstance
      },

      __setWrappedInstance(ref) {
        this.__wrappedInstance = ref
      },

      __initSelector() {
        const sourceSelector = selectorFactory(this.__store.dispatch, selectorFactoryOptions)
        this.__selector = makeSelectorStateful(sourceSelector, this.__store)
        this.__selector.run(this.props)
      },

      __initSubscription() {
        if (!shouldHandleStateChanges) return

        // parentSub's source should match where store came from: props vs. context. A component
        // connected to the store via props shouldn't use subscription from context, or vice versa.
        // const parentSub = (this.propsMode ? this.props : this.context)[subscriptionKey]
        this.__subscription = new Subscription(this.store, null, this.__onStateChange.bind(this))

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
          this[UPDATERKEY]()
          selector.shouldComponentUpdate = false
        }

        // else {
        //   this.componentDidUpdate = this.notifyNestedSubsOnComponentDidUpdate
        //   // this.setState(dummyState)
        // }
      },

      // notifyNestedSubsOnComponentDidUpdate() {
      //   // `componentDidUpdate` is conditionally implemented when `onStateChange` determines it
      //   // needs to notify nested subs. Once called, it unimplements itself until further state
      //   // changes occur. Doing it this way vs having a permanent `componentDidUpdate` that does
      //   // a boolean check every time avoids an extra method call most of the time, resulting
      //   // in some perf boost.
      //   this.componentDidUpdate = undefined
      //   this.notifyNestedSubs()
      // },

      __isSubscribed() {
        return Boolean(this.__subscription) && this.__subscription.isSubscribed()
      },

      // addExtraProps(props) {
      //   if (!withRef && !renderCountProp && !(this.propsMode && this.subscription)) return props
      //   // make a shallow copy so that fields added don't leak to the original selector.
      //   // this is especially important for 'ref' since that's a reference back to the component
      //   // instance. a singleton memoized selector would then be holding a reference to the
      //   // instance, preventing the instance from being garbage collected, and that would be bad
      //   const withExtras = { ...props }
      //   if (withRef) withExtras.ref = this.setWrappedInstance
      //   if (renderCountProp) withExtras[renderCountProp] = this.renderCount++
      //   if (this.propsMode && this.subscription) withExtras[subscriptionKey] = this.subscription
      //   return withExtras
      // },

      // render() {
      //   const selector = this.selector
      //   selector.shouldComponentUpdate = false

      //   if (selector.error) {
      //     throw selector.error
      //   } else {
      //     return createElement(wrappedObject, this.addExtraProps(selector.props))
      //   }
      // }
    }

    connect.__wrappedObject = wrappedObject
    connect.__displayName = displayName
    // Connect.childContextTypes = childContextTypes
    // Connect.contextTypes = contextTypes
    // Connect.propTypes = contextTypes

    // if (process.env.NODE_ENV !== 'production') {
    //   Connect.prototype.componentWillUpdate = function componentWillUpdate() {
    //     // We are hot reloading!
    //     if (this.version !== version) {
    //       this.version = version
    //       this.initSelector()

    //       // If any connected descendants don't hot reload (and resubscribe in the process), their
    //       // listeners will be lost when we unsubscribe. Unfortunately, by copying over all
    //       // listeners, this does mean that the old versions of connected descendants will still be
    //       // notified of state changes; however, their onStateChange function is a no-op so this
    //       // isn't a huge deal.
    //       let oldListeners = [];

    //       if (this.subscription) {
    //         oldListeners = this.subscription.listeners.get()
    //         this.subscription.tryUnsubscribe()
    //       }
    //       this.initSubscription()
    //       if (shouldHandleStateChanges) {
    //         this.subscription.trySubscribe()
    //         oldListeners.forEach(listener => this.subscription.listeners.subscribe(listener))
    //       }
    //     }
    //   }
    // }

    // return hoistStatics(Connect, wrappedObject)
    return connect
  }
}

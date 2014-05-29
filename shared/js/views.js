/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global loop:true */

var loop = loop || {};
loop.shared = loop.shared || {};
loop.shared.views = (function(_, OT, l10n) {
  "use strict";

  var sharedModels = loop.shared.models;

  /**
   * L10n view. Translates resulting view DOM fragment once rendered.
   */
  var L10nView = (function() {
    var L10nViewImpl = Backbone.View.extend(),
        extend       = L10nViewImpl.extend;

    // Patches View extend() method so we can hook and patch any declared render
    // method.
    L10nViewImpl.extend = function() {
      var ExtendedView = extend.apply(this, arguments),
          render       = ExtendedView.prototype.render;

      // Wraps original render() method to translate contents once they're
      // rendered.
      ExtendedView.prototype.render = function() {
        if (render) {
          render.apply(this, arguments);
          l10n.translate(this.el);
        }
        return this;
      };

      return ExtendedView;
    };

    return L10nViewImpl;
  })();

  /**
   * Base view.
   */
  var BaseView = L10nView.extend({
    /**
     * Hides view element.
     *
     * @return {BaseView}
     */
    hide: function() {
      this.$el.hide();
      return this;
    },

    /**
     * Shows view element.
     *
     * @return {BaseView}
     */
    show: function() {
      this.$el.show();
      return this;
    },

    /**
     * Base render implementation: renders an attached template if available.
     *
     * Note: You need to override this if you want to do fancier stuff, eg.
     *       rendering the template using model data.
     *
     * @return {BaseView}
     */
    render: function() {
      if (this.template) {
        this.$el.html(this.template());
      }
      return this;
    }
  });

  /**
   * Conversation view.
   */
  var ConversationView = BaseView.extend({
    className: "conversation",

    template: _.template([
      '<nav class="controls">',
      '  <button class="btn stop" data-l10n-id="stop"></button>',
      '</nav>',
      '<div class="media nested">',
      // Both these wrappers are required by the SDK; this is fragile and
      // will break if a future version of the SDK updates this generated DOM,
      // especially as the SDK seems to actually move wrapped contents into
      // their own generated stuff.
      '  <div class="remote"><div class="incoming"></div></div>',
      '  <div class="local"><div class="outgoing"></div></div>',
      '</div>'
    ].join("")),

    // height set to "auto" to fix video layout on Google Chrome
    // @see https://bugzilla.mozilla.org/show_bug.cgi?id=991122
    videoStyles: { width: "100%", height: "auto" },

    events: {
      'click .btn.stop': 'hangup'
    },

    /**
     * Establishes webrtc communication using OT sdk.
     */
    initialize: function(options) {
      options = options || {};
      if (!options.sdk) {
        throw new Error("missing required sdk");
      }
      this.sdk = options.sdk;

      // XXX: this feels like to be moved to the ConversationModel, but as it's
      // tighly coupled with the DOM (element ids to receive streams), we'd need
      // an abstraction we probably don't want yet.
      this.session = this.sdk.initSession(this.model.get("sessionId"));
      this.session.connect(this.model.get("apiKey"),
                           this.model.get("sessionToken"));

      this.listenTo(this.session, "sessionConnected", this._sessionConnected);
      this.listenTo(this.session, "streamCreated", this._streamCreated);
      this.listenTo(this.session, "connectionDestroyed",
                                  this._connectionDestroyed);
      this.listenTo(this.session, "sessionDisconnected",
                                  this._sessionDisconnected);
      this.listenTo(this.session, "networkDisconnected",
                                  this._networkDisconnected);
    },

    hangup: function(event) {
      event.preventDefault();
      this.session.disconnect();
    },

    /**
     * Session is created.
     * http://tokbox.com/opentok/libraries/client/js/reference/SessionConnectEvent.html
     *
     * @param  {SessionConnectEvent} event
     */
    _sessionConnected: function(event) {
      this.publisher = this.sdk.initPublisher(this.$(".outgoing").get(0),
                                              this.videoStyles);
      this.session.publish(this.publisher);
    },

    /**
     * New created streams are available.
     * http://tokbox.com/opentok/libraries/client/js/reference/StreamEvent.html
     *
     * @param  {StreamEvent} event
     */
    _streamCreated: function(event) {
      this._subscribeToStreams(event.streams);
    },

    /**
     * Local user hung up.
     * http://tokbox.com/opentok/libraries/client/js/reference/SessionDisconnectEvent.html
     *
     * @param  {SessionDisconnectEvent} event
     */
    _sessionDisconnected: function(event) {
      this.model.trigger("session:ended");
    },

    /**
     * Peer hung up. Disconnects local session.
     * http://tokbox.com/opentok/libraries/client/js/reference/ConnectionEvent.html
     *
     * @param  {ConnectionEvent} event
     */
    _connectionDestroyed: function(event) {
      this.model.trigger("session:peer-hungup", {
        connectionId: event.connection.connectionId
      });
      this.session.unpublish(this.publisher);
      this.session.disconnect();
    },

    /**
     * Network was disconnected.
     * http://tokbox.com/opentok/libraries/client/js/reference/ConnectionEvent.html
     *
     * @param {ConnectionEvent} event
     */
    _networkDisconnected: function(event) {
      this.model.trigger("session:network-disconnected");
      this.session.unpublish(this.publisher);
      this.session.disconnect();
    },

    /**
     * Subscribes and attaches each available stream to a DOM element.
     *
     * XXX: for now we only support a single remote stream, hence a singe DOM
     *      element.
     *
     * @param  {Array} streams A list of media streams.
     */
    _subscribeToStreams: function(streams) {
      var incomingContainer = this.$(".incoming").get(0);
      streams.forEach(function(stream) {
        if (stream.connection.connectionId !==
            this.session.connection.connectionId) {
          this.session.subscribe(stream, incomingContainer, this.videoStyles);
        }
      }.bind(this));
    },

    /**
     * Renders this view.
     *
     * @return {ConversationView}
     */
    render: function() {
      this.$el.html(this.template(this.model.toJSON()));
      return this;
    }
  });

  /**
   * Notification view.
   */
  var NotificationView = BaseView.extend({
    template: _.template([
      '<div class="alert alert-<%- level %>">',
      '  <button class="close"></button>',
      '  <p class="message"><%- message %></p>',
      '</div>'
    ].join("")),

    events: {
      "click .close": "dismiss"
    },

    dismiss: function(event) {
      event.preventDefault();
      this.$el.addClass("fade-out");
      setTimeout(function() {
        this.collection.remove(this.model);
        this.remove();
      }.bind(this), 500); // XXX make timeout value configurable
    },

    render: function() {
      this.$el.html(this.template(this.model.toJSON()));
      return this;
    }
  });

  /**
   * Notification list view.
   */
  var NotificationListView = Backbone.View.extend({
    /**
     * Constructor.
     *
     * Available options:
     * - {loop.shared.models.NotificationCollection} collection Notifications
     *                                                          collection
     *
     * @param  {Object} options Options object
     */
    initialize: function(options) {
      options = options || {};
      if (!options.collection) {
        this.collection = new sharedModels.NotificationCollection();
      }
      this.listenTo(this.collection, "reset add remove", this.render);
    },

    /**
     * Clears the notification stack.
     */
    clear: function() {
      this.collection.reset();
    },

    /**
     * Adds a new notification to the stack, triggering rendering of it.
     *
     * @param  {Object|NotificationModel} notification Notification data.
     */
    notify: function(notification) {
      this.collection.add(notification);
    },

    /**
     * Adds a warning notification to the stack and renders it.
     *
     * @return {String} message
     */
    warn: function(message) {
      this.notify({level: "warning", message: message});
    },

    /**
     * Adds an error notification to the stack and renders it.
     *
     * @return {String} message
     */
    error: function(message) {
      this.notify({level: "error", message: message});
    },

    /**
     * Renders this view.
     *
     * @return {loop.shared.views.NotificationListView}
     */
    render: function() {
      this.$el.html(this.collection.map(function(notification) {
        return new NotificationView({
          model: notification,
          collection: this.collection
        }).render().$el;
      }.bind(this)));
      return this;
    }
  });

  return {
    L10nView: L10nView,
    BaseView: BaseView,
    ConversationView: ConversationView,
    NotificationListView: NotificationListView,
    NotificationView: NotificationView
  };
})(_, window.OT, document.webL10n || document.mozL10n);
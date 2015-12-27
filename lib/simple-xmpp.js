/**

 The MIT License

 Copyright (c) 2011 Arunoda Susiripala

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.

 */

var xmpp         = require('node-xmpp-client');
var Stanza       = xmpp.Stanza;
var EventEmitter = require('events').EventEmitter;
var util         = require('util');
var qbox         = require('qbox');

var STATUS = {
    AWAY:    "away",
    DND:     "dnd",
    XA:      "xa",
    ONLINE:  "online",
    OFFLINE: "offline"
};

var NS_CHATSTATES = "http://jabber.org/protocol/chatstates";

module.exports = new SimpleXMPP();

function SimpleXMPP() {

    //setting status here
    this.STATUS      = STATUS;
    var self         = this;

    this.config = null;
    this.conn = null;
    this.probeBuddies = {};
    this.joinedRooms  = {};
    this.capabilities = {};
    this.capBuddies   = {};
    this.iqCallbacks  = {};
    this.$            = qbox.create();

    this.events          = new EventEmitter();


    this.on             = function () {
        this.events.on.apply(this.events, Array.prototype.slice.call(arguments));
    };

    this.removeListener = function () {
        this.events.removeListener.apply(this.events, Array.prototype.slice.call(arguments));
    };

    this.send = function (to, message, group) {

        this.$.ready(function () {
            var stanza = new xmpp.Stanza('message', {to: to, type: (group ? 'groupchat' : 'chat')});
            stanza.c('body').t(message);
            self.conn.send(stanza);
        });
    };

    this.join = function (to, password) {

        this.$.ready(function () {
            var room = to.split('/')[0];
            if (!self.joinedRooms[room]) {
                self.joinedRooms[room] = true;
            }
            var stanza = new Stanza('presence', {to: to}).c('x', {xmlns: 'http://jabber.org/protocol/muc'});
            // XEP-0045 7.2.6 Password-Protected Rooms
            if (password != null && password != "") {
                stanza.c('password').t(password);
            }
            self.conn.send(stanza);
        });
    };

    this.invite = function (to, room, reason) {

        this.$.ready(function () {
            var stanza = new Stanza('message', {to: room}).c('x', {xmlns: 'http://jabber.org/protocol/muc#user'}).c('invite', {to: to});
            if (reason) {
                stanza.c('reason').t(reason);
            }
            self.conn.send(stanza);
        });

    };

    this.subscribe = function (to) {

        this.$.ready(function () {
            var stanza = new Stanza('presence', {to: to, type: 'subscribe'});
            self.conn.send(stanza);
        });
    };

    this.unsubscribe = function (to) {

        this.$.ready(function () {
            var stanza = new Stanza('presence', {to: to, type: 'unsubscribe'});
            self.conn.send(stanza);
        });
    };

    this.acceptSubscription = function (to) {

        // Send a 'subscribed' notification back to accept the incoming
        // subscription request
        this.$.ready(function () {
            var stanza = new Stanza('presence', {to: to, type: 'subscribed'});
            self.conn.send(stanza);
        });
    };

    this.acceptUnsubscription = function (to) {

        this.$.ready(function () {
            var stanza = new Stanza('presence', {to: to, type: 'unsubscribed'});
            self.conn.send(stanza);
        });
    };

    this.getRoster = function () {

        this.$.ready(function () {
            var roster = new Stanza('iq', {id: 'roster_0', type: 'get'});
            roster.c('query', {xmlns: 'jabber:iq:roster'});
            self.conn.send(roster);
        });
    };

    this.probe = function (buddy, callback) {

        self.probeBuddies[buddy] = true;
        this.$.ready(function () {
            var stanza = new Stanza('presence', {type: 'probe', to: buddy});
            self.events.once('probe_' + buddy, callback);
            self.conn.send(stanza);
        });
    };

    function parseVCard(vcard) {
        //it appears, that vcard could be null
        //in the case, no vcard is set yet, so to avoid crashing, just return null
        if (!vcard) {
            return null;
        }
        return vcard.children.reduce(function (jcard, child) {
            jcard[child.name.toLowerCase()] = (
                (typeof(child.children[0]) === 'object') ?
                    parseVCard(child) :
                    child.children.join('')
            );
            return jcard;
        }, {});
    }

    this.getVCard = function (buddy, callback) {
        this.$.ready(function () {
            var id          = 'get-vcard-' + buddy.split('@').join('--');
            var stanza      = new Stanza('iq', {type: 'get', id: id}).c('vCard', {xmlns: 'vcard-temp'}).up();
            self.iqCallbacks[id] = function (response) {
                if (response.attrs.type === 'error') {
                    callback(null);
                }
                else {
                    callback(parseVCard(response.children[0]));
                }
            };
            self.conn.send(stanza);
        });
    };


    this.getVCardForUser = function (jid, user, callback) {
        this.$.ready(function () {
            var id          = 'get-vcard-' + user.split('@').join('-');
            var stanza      = new Stanza('iq', {
                from: jid,
                type: 'get',
                id:   id,
                to:   user
            }).c('vCard', {xmlns: 'vcard-temp'}).up();
            self.iqCallbacks[id] = function (response) {
                if (response.attrs.type === 'error') {
                    callback(null);
                }
                else {
                    var responseObj = {
                        vcard: parseVCard(response.children[0]),
                        jid:   jid,
                        user:  user
                    };
                    callback(responseObj);
                }
            };
            self.conn.send(stanza);
        });
    };

    // Method: setPresence
    //
    // Change presence appearance and set status message.
    //
    // Parameters:
    //   show     - <show/> value to send. Valid values are: ['away', 'chat', 'dnd', 'xa'].
    //              See http://xmpp.org/rfcs/rfc3921.html#rfc.section.2.2.2.1 for details.
    //              Pass anything that evaluates to 'false' to skip sending the <show/> element.
    //   status   - (optional) status string. This is free text.
    //   priority - (optional) priority integer. Ranges from -128 to 127.
    //              See http://xmpp.org/rfcs/rfc3921.html#rfc.section.2.2.2.3 for details.
    //
    // TODO:
    // * add caps support
    this.setPresence = function (show, status, priority) {
        this.$.ready(function () {
            var stanza = new Stanza('presence');
            if (show && show !== STATUS.ONLINE) {
                stanza.c('show').t(show);
            }
            if (typeof(status) !== 'undefined') {
                stanza.c('status').t(status);
            }
            if (typeof(priority) !== 'undefined') {
                if (typeof(priority) !== 'number') {
                    priority = 0;
                }
                else if (priority < -128) {
                    priority = -128;
                }
                else if (priority > 127) {
                    priority = 127;
                }
                stanza.c('priority').t(parseInt(priority));
            }
            self.conn.send(stanza);
        });
    };

    // Method: setChatstate
    //
    // Send current chatstate to the given recipient. Chatstates are defined in
    // <XEP-0085 at http://xmpp.org/extensions/xep-0085.html>.
    //
    // Parameters:
    //   to    - JID to send the chatstate to
    //   state - State to publish. One of: active, composing, paused, inactive, gone
    //
    // See XEP-0085 for details on the meaning of those states.
    this.setChatstate = function (to, state) {
        this.$.ready(function () {
            var stanza = new Stanza('message', {to: to}).c(state, {xmlns: NS_CHATSTATES}).up();
            self.conn.send(stanza);
        });
    };


    this.disconnect = function () {
        this.$.ready(function () {
            var stanza = new Stanza('presence', {type: 'unavailable'});
            stanza.c('status').t('Logged out');
            self.conn.send(stanza);
        });

        var ref = this.conn.connection;
        if (ref.socket.writable) {
            if (ref.streamOpened) {
                ref.socket.write('</stream:stream>');
                delete ref.streamOpened;
            }
            else {
                ref.socket.end();
            }
        }
    };

    this.setupConnection = function () {
        this.conn.on('close', this._onClose.bind(this));
        this.conn.on('error', this._onError.bind(this));
        this.conn.on('online', this._onOnline.bind(this));
        this.conn.on('stanza', this._onStanza.bind(this));
    };

    /**
     *
     *
     * Additional options:
     *   connection - already established node-xmpp-client.Client connection
     *   skipPresence - don't send initial empty <presence/> when connecting
     *
     * @param {Object} params
     */
    this.connect = function (params) {

        this.config = params;
        this.conn   = this.config.connection || new xmpp.Client(params);

        this.setupConnection();
    };


    this._onClose = function () {
        this.$.stop();
        this.events.emit('close');
    };

    this._onError = function (err) {
        this.events.emit('error', err);
    };

    this._onOnline = function (data) {
        if (!this.config.skipPresence) {
            this.conn.send(new Stanza('presence'));
        }

        this.events.emit('online', data);
        this.$.start();

        // keepalive
        if (self.conn.connection.socket) {
            self.conn.connection.socket.setTimeout(0);
            self.conn.connection.socket.setKeepAlive(true, 10000);
        }
    };

    this._onStanza = function (stanza) {
        this.events.emit('stanza', stanza);
        //console.log(stanza);
        //looking for message stanza
        if (stanza.is('message')) {

            this._handleStanzaMessage(stanza);

        }
        else if (stanza.is('presence')) {

            this._handleStanzaPresence(stanza);

        }
        else if (stanza.is('iq')) {

            this._handleStanzaIq(stanza);

        }
        else {
            this.events.emit('unhandledStanza', stanza);
        }
    };

    this._handleStanzaMessage = function (stanza) {
        var body, message, from, id, conference;
        //getting the chat message
        if (stanza.attrs.type == 'chat') {

            body = stanza.getChild('body');
            if (body) {
                message = body.getText();
                from    = stanza.attrs.from;
                id      = from.split('/')[0];
                this.events.emit('chat', id, message, stanza);
            }

            var chatstate = stanza.getChildByAttr('xmlns', NS_CHATSTATES);
            if (chatstate) {
                // Event: chatstate
                //
                // Emitted when an incoming <message/> with a chatstate notification
                // is received.
                //
                // Event handler parameters:
                //   jid   - the JID this chatstate notification originates from
                //   state - new chatstate we're being notified about.
                //
                // See <SimpleXMPP#setChatstate> for details on chatstates.
                //
                this.events.emit('chatstate', stanza.attrs.from, chatstate.name, stanza);
            }

        }
        else if (stanza.attrs.type == 'groupchat') {

            body = stanza.getChild('body');
            if (body) {
                message    = body.getText();
                from       = stanza.attrs.from;
                conference = from.split('/')[0];
                id         = from.split('/')[1];
                var stamp  = null;
                if (stanza.getChild('x') && stanza.getChild('x').attrs.stamp) {
                    stamp = stanza.getChild('x').attrs.stamp;
                }
                this.events.emit('groupchat', conference, id, message, stamp, stanza);
            }
            else {
                this.events.emit('unhandledStanza', stanza);
            }
        }
        else {
            this.events.emit('unhandledStanza', stanza);
        }
    };

    this._handleStanzaPresence = function (stanza) {

        var from = stanza.attrs.from;
        if (!from) {
            this.events.emit('unhandledStanza', stanza);
            return;
        }

        if (stanza.attrs.type == 'subscribe') {
            //handling incoming subscription requests
            this.events.emit('subscribe', from, stanza);
        }
        else if (stanza.attrs.type == 'unsubscribe') {
            //handling incoming unsubscription requests
            this.events.emit('unsubscribe', from, stanza);
        }
        else {
            //looking for presence stenza for availability changes
            var id         = from.split('/')[0];
            var resource   = from.split('/')[1];
            var statusText = stanza.getChildText('status');
            var state      = (stanza.getChild('show')) ? stanza.getChild('show').getText() : STATUS.ONLINE;
            state          = (state == 'chat') ? STATUS.ONLINE : state;
            state          = (stanza.attrs.type == 'unavailable') ? STATUS.OFFLINE : state;
            //checking if this is based on probe
            if (this.probeBuddies[id]) {
                this.events.emit('probe_' + id, state, statusText, stanza);
                delete this.probeBuddies[id];
            }
            else {
                //specifying roster changes
                if (this.joinedRooms[id]) {
                    var groupBuddy = from.split('/')[1];
                    this.events.emit('groupbuddy', id, groupBuddy, state, statusText, stanza);
                }
                else {
                    this.events.emit('buddy', id, state, statusText, resource, stanza);
                }
            }

            // Check if capabilities are provided
            var caps = stanza.getChild('c', 'http://jabber.org/protocol/caps');
            if (caps) {
                var node = caps.attrs.node,
                    ver  = caps.attrs.ver;

                if (ver) {
                    var fullNode = node + '#' + ver;
                    // Check if it's already been cached
                    if (this.capabilities[fullNode]) {
                        this.events.emit('buddyCapabilities', id, this.capabilities[fullNode], stanza);
                    }
                    else {
                        // Save this buddy so we can send the capability data when it arrives
                        if (!this.capBuddies[fullNode]) {
                            this.capBuddies[fullNode] = [];
                        }
                        this.capBuddies[fullNode].push(id);

                        var getCaps = new Stanza('iq', {id: 'disco1', to: from, type: 'get'});
                        getCaps.c('query', {xmlns: 'http://jabber.org/protocol/disco#info', node: fullNode});
                        this.conn.send(getCaps);
                    }
                }
                else {
                    this.events.emit('unhandledStanza', stanza);
                }
            }
            else {
                this.events.emit('unhandledStanza', stanza);
            }

        }

    };

    this._handleStanzaIq = function (stanza) {
        if (stanza.getChild('ping', 'urn:xmpp:ping')) {
            this.conn.send(new Stanza('iq', {id: stanza.attrs.id, to: stanza.attrs.from, type: 'result'}));
        }
        // Response to capabilities request?
        else if (stanza.attrs.id === 'disco1') {
            var query = stanza.getChild('query', 'http://jabber.org/protocol/disco#info');

            // Ignore it if there's no <query> element - Not much we can do in this case!
            if (!query) {
                return;
            }

            var node     = query.attrs.node,
                identity = query.getChild('identity'),
                features = query.getChildren('feature');

            var result = {
                clientName: identity && identity.attrs.name,
                features:   features.map(function (feature) { return feature.attrs['var']; })
            };

            this.capabilities[node] = result;

            // Send it to all buddies that were waiting
            if (this.capBuddies[node]) {
                this.capBuddies[node].forEach(function (id) {
                    self.events.emit('buddyCapabilities', id, result, stanza);
                });
                delete this.capBuddies[node];
            }
        }
        else {
            this.events.emit('unhandledStanza', stanza);
        }

        var cb = this.iqCallbacks[stanza.attrs.id];
        if (cb) {
            cb(stanza);
            delete this.iqCallbacks[stanza.attrs.id];
        }
    };

}

SimpleXMPP.prototype.Element = xmpp.Element;

// Allow for multiple connections
module.exports.SimpleXMPP = SimpleXMPP;

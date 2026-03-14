/**
 * approach4_osc.js  –  Approach 4: OSC via udpsend / udpreceive
 *
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Open Sound Control (OSC) messages are sent over UDP loopback.  Each device
 * sends frame metadata to a well-known local port; any number of receivers
 * (on the same machine) can listen on that port.
 *
 *   Source  → [udpsend 127.0.0.1 <port>]
 *   FX/Hub  ← [udpreceive <port>]
 *
 * OSC address pattern:
 *   /m4lv/<rackId>/frame   – new frame available (full metadata payload)
 *   /m4lv/<rackId>/fx      – FX parameter update
 *   /m4lv/<rackId>/layer   – layer order change from Hub
 *
 * This file encodes/decodes these messages in the Max js layer.  The actual
 * UDP socket is handled by Max's native [udpsend] / [udpreceive] objects; this
 * script simply formats the message lists that are fed into them.
 *
 * ADVANTAGES
 *  + Cross-application: any OSC-capable app on localhost can participate
 *  + Stateless, fire-and-forget; no shared objects between patches
 *  + Easy to log/debug with OSC monitoring tools (e.g. OSCmonitor)
 *  + Can be extended to cross-machine setups by changing the target IP
 *
 * DISADVANTAGES
 *  – Network round-trip latency (negligible on loopback, ~0.1 ms)
 *  – No pixel data — metadata only; must be combined with Approach 1 or 2
 *    for actual frame content
 *  – Port numbers must be coordinated across devices; recommend storing in
 *    a Live Set parameter or a shared pattr
 *
 * RECOMMENDED PORT ASSIGNMENT
 *   Base port: 9000
 *   Rack port  = 9000 + (rackId % 1000)   — one port per rack
 *
 * MAX PATCH WIRING (pseudo-diagram)
 * ─────────────────────────────────
 * SOURCE
 *   [js approach4_osc.js]
 *     |  (outlet 0 – OSC message list → [udpsend 127.0.0.1 <port>])
 *
 * RECEIVER
 *   [udpreceive <port>]
 *     |
 *   [js approach4_osc.js]  ← inlet 1 receives raw OSC list
 *     |  (outlet 1 – decoded fields)
 */

// ---------------------------------------------------------------------------
// Inlets / Outlets
// ---------------------------------------------------------------------------
inlets  = 2;   // 0 = control, 1 = raw OSC list from udpreceive
outlets = 3;   // 0 = OSC message for udpsend, 1 = decoded fields, 2 = status

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var rackId  = "default";
var trackId = "";
var port    = 9000;

// Derive a consistent port from a numeric rackId string or keep a fixed one
function _computePort(id) {
    var n = parseInt(id, 10);
    return isNaN(n) ? 9000 : 9000 + (n % 1000);
}

// ---------------------------------------------------------------------------
// Control inlet (inlet 0)
// ---------------------------------------------------------------------------

function setRackId(id) {
    rackId = String(id);
    port   = _computePort(id);
    outlet(2, "OSC port set to: " + port);
}

function setTrackId(id) {
    trackId = String(id);
}

function setPort(p) {
    port = parseInt(p, 10);
    outlet(2, "OSC port overridden to: " + port);
}

// ---------------------------------------------------------------------------
// Encode a frame-info payload as an OSC message list.
// Output on outlet 0 → connect to [udpsend 127.0.0.1 <port>].
//
// The OSC address is the first element; all subsequent elements are the
// typed arguments (Max/OSC interop convention).
// ---------------------------------------------------------------------------

/**
 * @param {string} clipId
 * @param {number} playheadTime
 * @param {number} clipStartTime
 * @param {number} clipLength
 * @param {number} localTime
 * @param {string} filePath
 * @param {number} frameRate
 * @param {number} frameIndex
 * @param {number} width
 * @param {number} height
 * @param {number} layer
 */
function sendFrame(clipId, playheadTime, clipStartTime, clipLength,
                   localTime, filePath, frameRate, frameIndex,
                   width, height, layer) {
    var addr = "/m4lv/" + rackId + "/frame";
    var msg  = [
        addr,
        trackId, clipId,
        playheadTime, clipStartTime, clipLength, localTime,
        filePath, frameRate, frameIndex,
        width, height, layer,
        0, 0, 1.0, 1.0, 0, 1.0   // default transform
    ];
    outlet(0, msg);
}

/**
 * Send an FX parameter update.
 *
 * @param {string} fxName
 * @param {string} key
 * @param {number} value
 */
function sendFxParam(fxName, key, value) {
    var addr = "/m4lv/" + rackId + "/fx";
    outlet(0, [addr, trackId, fxName, key, value]);
}

/**
 * Send a layer order update from the Hub device.
 *
 * @param {string} srcTrackId
 * @param {number} layerIndex
 */
function sendLayerOrder(srcTrackId, layerIndex) {
    var addr = "/m4lv/" + rackId + "/layer";
    outlet(0, [addr, srcTrackId, layerIndex]);
}

// ---------------------------------------------------------------------------
// Decode incoming OSC messages arriving at inlet 1.
// [udpreceive <port>] → inlet 1 of this js object.
// ---------------------------------------------------------------------------

function list() {
    if (inlet !== 1) { return; }
    var args = arrayfromargs(arguments);
    if (args.length === 0) { return; }

    var addr = String(args[0]);

    if (addr.indexOf("/frame") !== -1 && args.length >= 19) {
        outlet(1, "trackId",       args[1]);
        outlet(1, "clipId",        args[2]);
        outlet(1, "playheadTime",  args[3]);
        outlet(1, "clipStartTime", args[4]);
        outlet(1, "clipLength",    args[5]);
        outlet(1, "localTime",     args[6]);
        outlet(1, "filePath",      args[7]);
        outlet(1, "frameRate",     args[8]);
        outlet(1, "frameIndex",    args[9]);
        outlet(1, "width",         args[10]);
        outlet(1, "height",        args[11]);
        outlet(1, "layer",         args[12]);
        outlet(1, "transform",
            args[13], args[14], args[15], args[16], args[17], args[18]);

    } else if (addr.indexOf("/fx") !== -1 && args.length >= 5) {
        outlet(1, "fx_param",
            args[1], args[2], args[3], args[4]);

    } else if (addr.indexOf("/layer") !== -1 && args.length >= 3) {
        outlet(1, "layer_order", args[1], args[2]);

    } else {
        outlet(2, "unknown OSC address: " + addr);
    }
}

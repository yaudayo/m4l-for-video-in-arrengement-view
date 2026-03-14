/**
 * video_fx.js  –  video_fx device (effects processor)
 *
 * PLACED IN THE SAME RACK as video_source, after it in the signal chain.
 * Multiple FX devices can be chained; each reads the current VideoFrameInfo,
 * applies its effect, and writes the modified info back so the next device
 * sees the transformed state.
 *
 * ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────────
 * Like an audio insert effect, video_fx is purely *destructive* (in-chain):
 *
 *   video_source → [video_fx A] → [video_fx B] → video_hub
 *
 * Each FX device:
 *   1. Receives video frame info via any of the five sharing approaches.
 *   2. Applies its transform/effect to the VideoFrameInfo (modifies transform
 *      fields or adds an entry to the effects dict).
 *   3. Re-broadcasts the modified info downstream using the same approaches.
 *
 * Built-in effect types (selected via the `setEffectType` message):
 *   "brightness"  – brightness offset applied to the Jitter matrix
 *   "contrast"    – contrast multiplier
 *   "blur"        – Gaussian blur radius
 *   "chroma_key"  – chroma-key / green-screen with configurable colour + range
 *   "opacity"     – global opacity of this layer
 *   "crop"        – crop rectangle (x, y, w, h normalised 0-1)
 *   "zoom"        – uniform scale
 *   "time_shift"  – temporal offset in seconds (slip-edit equivalent)
 *
 * MAX PATCH INLETS/OUTLETS
 * ─────────────────────────────────────────────────────────────────────────────
 * Inlets
 *   0 – control messages (setRackId, setTrackId, setEffectType, setParam, …)
 *   1 – frame-info list from upstream (Approach 2 / send-receive)
 *   2 – dict notification (Approach 3)
 *   3 – OSC message from udpreceive (Approach 4)
 *
 * Outlets
 *   0 – matrix name (Approach 1: after FX applied)
 *   1 – modified frame-info list (Approach 2: downstream send)
 *   2 – dict name (Approach 3: dict updated with FX result)
 *   3 – modified OSC message (Approach 4: downstream udpsend)
 *   4 – FX param name + value (Approach 5: pattr)
 *   5 – status / error string
 */

// ---------------------------------------------------------------------------
// Inlets / Outlets
// ---------------------------------------------------------------------------
inlets  = 4;
outlets = 6;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var rackId     = "default";
var trackId    = "";
var fxName     = "fx_unnamed";  // unique name for this FX instance in the chain
var effectType = "opacity";

/** Effect parameters keyed by name */
var effectParams = {
    brightness: 0.0,   // -1.0 .. 1.0
    contrast:   1.0,   // 0.5 .. 3.0
    blur:       0.0,   // 0 .. 20 pixels
    opacity:    1.0,   // 0.0 .. 1.0
    zoom:       1.0,   // 0.1 .. 4.0
    time_shift: 0.0,   // -10 .. 10 seconds
    chroma_r:   0.0,   // chroma key colour R 0-1
    chroma_g:   1.0,   // G
    chroma_b:   0.0,   // B
    chroma_tol: 0.15,  // tolerance 0-1
    crop_x:     0.0,
    crop_y:     0.0,
    crop_w:     1.0,
    crop_h:     1.0
};

// Last received frame info fields (cached for re-broadcast on param change)
var _lastFrame = null;

// Derived names
var _matrixName = "m4lv_default_matrix_fx";
var _channel    = "m4lv_default_frame";
var _dictName   = "m4lv_default_state";
var _oscPort    = 9000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _updateNames() {
    // FX devices share the same rack-level names as the source
    _matrixName = "m4lv_" + rackId + "_matrix_" + fxName;
    _channel    = "m4lv_" + rackId + "_frame";
    _dictName   = "m4lv_" + rackId + "_state";
    _oscPort    = 9000 + (parseInt(rackId, 10) % 1000 || 0);
}

/**
 * Parse a frame-info list (18+ elements) into a plain object.
 * @param {Array} args
 */
function _parseFrameList(args) {
    if (args.length < 18) { return null; }
    return {
        trackId:       args[0],
        clipId:        args[1],
        playheadTime:  args[2],
        clipStartTime: args[3],
        clipLength:    args[4],
        localTime:     args[5],
        filePath:      args[6],
        frameRate:     args[7],
        frameIndex:    args[8],
        width:         args[9],
        height:        args[10],
        layer:         args[11],
        tx: args[12], ty: args[13],
        sx: args[14], sy: args[15],
        rot: args[16], op: args[17]
    };
}

/**
 * Apply the current effect to a parsed frame object (modifies in place).
 * @param {object} frame
 */
function _applyEffect(frame) {
    switch (effectType) {
        case "opacity":
            frame.op = Math.max(0, Math.min(1, frame.op * effectParams.opacity));
            break;
        case "zoom":
            frame.sx *= effectParams.zoom;
            frame.sy *= effectParams.zoom;
            break;
        case "time_shift":
            frame.localTime  = Math.max(0, frame.localTime + effectParams.time_shift);
            frame.frameIndex = Math.floor(frame.localTime * frame.frameRate);
            break;
        // brightness / contrast / blur / chroma_key are Jitter operations
        // performed on the actual matrix in the .maxpat via jit.brcosa / jit.fastblur
        // etc.; we record them in the dict so the Hub knows which jit objects to drive.
        default:
            break;
    }
}

/**
 * Serialise a frame object back to a flat list.
 * @param {object} f
 * @returns {Array}
 */
function _frameToList(f) {
    return [
        f.trackId, f.clipId,
        f.playheadTime, f.clipStartTime, f.clipLength, f.localTime,
        f.filePath, f.frameRate, f.frameIndex,
        f.width, f.height, f.layer,
        f.tx, f.ty, f.sx, f.sy, f.rot, f.op
    ];
}

/** Broadcast the modified frame via all active approaches. */
function _broadcast(frame) {
    if (!frame) { return; }
    _applyEffect(frame);

    // Approach 1: name of the FX-processed matrix
    outlet(0, _matrixName);

    // Approach 2: modified list
    outlet(1, _frameToList(frame));

    // Approach 3: write to dict
    _writeFxToDict(frame);
    outlet(2, _dictName);

    // Approach 4: OSC
    var oscList = ["/m4lv/" + rackId + "/frame"].concat(_frameToList(frame));
    outlet(3, oscList);

    // Approach 5: pattr — emit automatable FX params
    for (var k in effectParams) {
        if (effectParams.hasOwnProperty(k)) {
            outlet(4, k, effectParams[k]);
        }
    }
}

function _writeFxToDict(frame) {
    var d      = new Dict(_dictName);
    var prefix = "tracks/" + trackId + "/effects/" + fxName + "/";
    d.set(prefix + "type",   effectType);
    for (var k in effectParams) {
        if (effectParams.hasOwnProperty(k)) {
            d.set(prefix + k, effectParams[k]);
        }
    }
    // Also update transform in the main track entry so Hub sees the result
    var tp = "tracks/" + trackId + "/";
    d.set(tp + "transform/scaleX",   frame.sx);
    d.set(tp + "transform/scaleY",   frame.sy);
    d.set(tp + "transform/opacity",  frame.op);
    d.set(tp + "transform/rotation", frame.rot);
    d.set(tp + "localTime",          frame.localTime);
    d.set(tp + "frameIndex",         frame.frameIndex);
}

// ---------------------------------------------------------------------------
// Control inlet (inlet 0)
// ---------------------------------------------------------------------------

function setRackId(id) {
    rackId = String(id);
    _updateNames();
    outlet(5, "video_fx rack: " + rackId);
}

function setTrackId(id) {
    trackId = String(id);
    _updateNames();
}

function setFxName(name) {
    fxName = String(name);
    _updateNames();
}

function setEffectType(type) {
    effectType = String(type);
    outlet(5, "video_fx effect type: " + effectType);
}

function setParam(key, value) {
    if (effectParams.hasOwnProperty(key)) {
        effectParams[key] = parseFloat(value);
        // Re-apply to last frame if available
        if (_lastFrame) {
            var f = JSON.parse(JSON.stringify(_lastFrame));
            _broadcast(f);
        }
        outlet(4, key, effectParams[key]);
    } else {
        outlet(5, "video_fx: unknown param: " + key);
    }
}

function bang() {
    if (_lastFrame) {
        var f = JSON.parse(JSON.stringify(_lastFrame));
        _broadcast(f);
    }
}

// ---------------------------------------------------------------------------
// Inlet 1: frame-info list (Approach 2, from upstream send/receive)
// ---------------------------------------------------------------------------

function list() {
    if (inlet !== 1) { return; }
    var args  = arrayfromargs(arguments);
    var frame = _parseFrameList(args);
    if (!frame) {
        outlet(5, "video_fx: malformed frame list (length=" + args.length + ")");
        return;
    }
    _lastFrame = JSON.parse(JSON.stringify(frame));
    _broadcast(frame);
}

// ---------------------------------------------------------------------------
// Inlet 2: dict change notification (Approach 3)
// ─────────────────────────────────────────────────────────────────────────────
// The .maxpat connects a [dict.view m4lv_<rackId>_state] to inlet 2.
// On change, we read back our track's entry from the dict.
// ---------------------------------------------------------------------------

function bang() {
    if (inlet === 2) {
        var d      = new Dict(_dictName);
        var prefix = "tracks/" + trackId + "/";
        var frame  = {
            trackId:       trackId,
            clipId:        d.get(prefix + "clipId"),
            playheadTime:  d.get(prefix + "playheadTime"),
            clipStartTime: d.get(prefix + "clipStartTime"),
            clipLength:    d.get(prefix + "clipLength"),
            localTime:     d.get(prefix + "localTime"),
            filePath:      d.get(prefix + "filePath"),
            frameRate:     d.get(prefix + "frameRate"),
            frameIndex:    d.get(prefix + "frameIndex"),
            width:         d.get(prefix + "width"),
            height:        d.get(prefix + "height"),
            layer:         d.get(prefix + "layer"),
            tx:  d.get(prefix + "transform/x"),
            ty:  d.get(prefix + "transform/y"),
            sx:  d.get(prefix + "transform/scaleX"),
            sy:  d.get(prefix + "transform/scaleY"),
            rot: d.get(prefix + "transform/rotation"),
            op:  d.get(prefix + "transform/opacity")
        };
        _lastFrame = JSON.parse(JSON.stringify(frame));
        _broadcast(frame);
        return;
    }
    // inlet 0 bang
    if (_lastFrame) {
        var f = JSON.parse(JSON.stringify(_lastFrame));
        _broadcast(f);
    }
}

// ---------------------------------------------------------------------------
// Inlet 3: OSC list from udpreceive (Approach 4)
// ---------------------------------------------------------------------------

function msg_int(v) { /* unused */ }
function msg_float(v) { /* unused */ }

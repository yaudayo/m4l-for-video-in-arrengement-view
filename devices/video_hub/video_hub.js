/**
 * video_hub.js  –  video_hub device (group/master layer compositor)
 *
 * PLACED ON A GROUP TRACK OR THE MASTER TRACK.
 * The Hub collects VideoFrameInfo streams from all child tracks, composites
 * them into a single output frame, and sends the result downstream
 * (to another Hub on the master, or directly to a video output).
 *
 * ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Track 1 (video_source + video_fx)  ─────┐
 *   Track 2 (video_source + video_fx)  ─────┤─→ [video_hub (Group A)]
 *   Track 3 (video_source + video_fx)  ─────┘
 *
 *   Group A  ──────────────────────────────────→ [video_hub (Master)]
 *
 * COMPOSITING MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * Each child track's frame is treated as a *layer*.  Layers are sorted by
 * their `layer` index (highest = front) and blended onto a canvas using the
 * configured blend mode (alpha-over by default).
 *
 * The Hub listens to the rack-shared data via all five approaches and selects
 * the best available one at runtime:
 *   Priority 1: Named Jitter Matrix  (Approach 1 — zero-copy, fastest)
 *   Priority 2: send / receive       (Approach 2 — in-process, no network)
 *   Priority 3: Shared Dict          (Approach 3 — structured, persistent)
 *   Priority 4: OSC                  (Approach 4 — cross-app fallback)
 *   Priority 5: pattr               (Approach 5 — control params only)
 *
 * MAX PATCH INLETS/OUTLETS
 * ─────────────────────────────────────────────────────────────────────────────
 * Inlets
 *   0 – control (setRackId, addTrack, removeTrack, setBlendMode, bang, …)
 *   1 – frame-info list (Approach 2: from child track sends)
 *   2 – dict change notification (Approach 3)
 *   3 – OSC message (Approach 4)
 *
 * Outlets
 *   0 – composite matrix name  (Approach 1: final composited matrix)
 *   1 – composite frame-info list (Approach 2: to parent Hub / output)
 *   2 – dict name (Approach 3: composite written to dict)
 *   3 – OSC composite message (Approach 4)
 *   4 – param updates (Approach 5)
 *   5 – status / error
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
var trackId    = "hub";   // this Hub's own track id
var blendMode  = "over";  // "over" | "add" | "multiply" | "screen"

/**
 * Registry of child tracks contributing layers to this Hub.
 * Map: childTrackId → { layer, filePath, frameIndex, width, height,
 *                       tx, ty, sx, sy, rot, op, matrixName }
 */
var layers = {};

// The Hub's own output matrix name
var _outputMatrixName = "m4lv_default_hub_output";
var _channel          = "m4lv_default_frame";
var _dictName         = "m4lv_default_state";
var _oscPort          = 9000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _updateNames() {
    _outputMatrixName = "m4lv_" + rackId + "_hub_output";
    _channel          = "m4lv_" + rackId + "_frame";
    _dictName         = "m4lv_" + rackId + "_state";
    _oscPort          = 9000 + (parseInt(rackId, 10) % 1000 || 0);
}

/**
 * Parse a frame-info list into a layer entry.
 * @param {Array} args  18+ element flat list
 * @returns {object|null}
 */
function _parseFrameList(args) {
    if (args.length < 18) { return null; }
    return {
        trackId:    args[0],
        clipId:     args[1],
        playheadTime: args[2],
        filePath:   args[6],
        frameRate:  args[7],
        frameIndex: args[8],
        width:      args[9],
        height:     args[10],
        layer:      args[11],
        tx:  args[12], ty:  args[13],
        sx:  args[14], sy:  args[15],
        rot: args[16], op:  args[17],
        matrixName: "m4lv_" + rackId + "_matrix_" + args[0]
    };
}

/**
 * Return layers sorted by z-index (ascending = back to front).
 * @returns {Array}
 */
function _sortedLayers() {
    var keys   = [];
    for (var k in layers) {
        if (layers.hasOwnProperty(k)) { keys.push(k); }
    }
    keys.sort(function (a, b) { return layers[a].layer - layers[b].layer; });
    return keys.map(function (k) { return layers[k]; });
}

/**
 * Trigger the Jitter compositing pipeline and broadcast the result.
 * In the .maxpat a [jit.op @op sfade] chain or [jit.gl.render] does the
 * actual pixel blend; this function emits the sorted layer list as messages
 * so the patch knows the order and parameters to use.
 */
function _composite() {
    var sorted = _sortedLayers();
    if (sorted.length === 0) {
        outlet(5, "video_hub: no layers");
        return;
    }

    // Emit each layer in order so the .maxpat can route matrices to the
    // compositor.  Each "layer" message: [layer, index, matrixName, op, sx, sy, tx, ty, rot]
    for (var i = 0; i < sorted.length; i++) {
        var L = sorted[i];
        outlet(0, "layer", i, L.matrixName,
               L.op, L.sx, L.sy, L.tx, L.ty, L.rot);
    }

    // Approach 1: output the name of the composite matrix
    outlet(0, "output", _outputMatrixName);

    // Approach 2: broadcast a composite frame-info list
    var top = sorted[sorted.length - 1];
    outlet(1, [
        trackId, "composite",
        top.playheadTime, 0, 0, top.playheadTime,
        "", top.frameRate, top.frameIndex,
        top.width, top.height, 0,
        0, 0, 1, 1, 0, 1
    ]);

    // Approach 3: write composite entry to dict
    _writeCompositeToDict(sorted);
    outlet(2, _dictName);

    // Approach 4: OSC
    outlet(3, [
        "/m4lv/" + rackId + "/hub/composite",
        trackId, sorted.length, blendMode
    ]);
}

function _writeCompositeToDict(sorted) {
    var d = new Dict(_dictName);
    d.set("composite/trackId",    trackId);
    d.set("composite/layerCount", sorted.length);
    d.set("composite/blendMode",  blendMode);
    for (var i = 0; i < sorted.length; i++) {
        var L      = sorted[i];
        var prefix = "composite/layers/" + i + "/";
        d.set(prefix + "trackId",    L.trackId);
        d.set(prefix + "matrixName", L.matrixName);
        d.set(prefix + "opacity",    L.op);
        d.set(prefix + "scaleX",     L.sx);
        d.set(prefix + "scaleY",     L.sy);
    }
}

/**
 * Read all child track entries from the shared dict and refresh layers.
 * Called on a Approach 3 change notification.
 */
function _readLayersFromDict() {
    var d = new Dict(_dictName);
    // Iterate over registered childTrackIds
    for (var id in layers) {
        if (!layers.hasOwnProperty(id)) { continue; }
        var prefix = "tracks/" + id + "/";
        layers[id].filePath   = d.get(prefix + "filePath");
        layers[id].frameIndex = d.get(prefix + "frameIndex");
        layers[id].layer      = d.get(prefix + "layer");
        layers[id].op         = d.get(prefix + "transform/opacity");
        layers[id].sx         = d.get(prefix + "transform/scaleX");
        layers[id].sy         = d.get(prefix + "transform/scaleY");
        layers[id].rot        = d.get(prefix + "transform/rotation");
        layers[id].tx         = d.get(prefix + "transform/x");
        layers[id].ty         = d.get(prefix + "transform/y");
    }
    _composite();
}

// ---------------------------------------------------------------------------
// Control inlet (inlet 0)
// ---------------------------------------------------------------------------

function setRackId(id) {
    rackId = String(id);
    _updateNames();
    outlet(5, "video_hub rack: " + rackId);
}

function setTrackId(id) {
    trackId = String(id);
    outlet(5, "video_hub self-track: " + trackId);
}

function setBlendMode(mode) {
    blendMode = String(mode);
    outlet(5, "video_hub blend: " + blendMode);
}

/**
 * Register a child track so the Hub polls it for layer data.
 * @param {string} childId  - Live track id of the child
 * @param {number} layerIdx - initial z-order (can be changed later)
 */
function addTrack(childId, layerIdx) {
    layers[String(childId)] = {
        trackId:    String(childId),
        clipId:     "",
        playheadTime: 0,
        filePath:   "",
        frameRate:  30,
        frameIndex: 0,
        width:      1920,
        height:     1080,
        layer:      parseInt(layerIdx, 10) || 0,
        tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, op: 1,
        matrixName: "m4lv_" + rackId + "_matrix_" + childId
    };
    outlet(5, "video_hub added track: " + childId);
}

/**
 * Remove a child track from the layer registry.
 * @param {string} childId
 */
function removeTrack(childId) {
    delete layers[String(childId)];
    outlet(5, "video_hub removed track: " + childId);
}

/**
 * Update the z-order of a child track layer.
 * @param {string} childId
 * @param {number} newLayer
 */
function setLayerOrder(childId, newLayer) {
    childId = String(childId);
    if (layers.hasOwnProperty(childId)) {
        layers[childId].layer = parseInt(newLayer, 10);
        _composite();
    }
}

function bang() {
    if (inlet === 0 || inlet === 2) {
        if (inlet === 2) {
            _readLayersFromDict();
        } else {
            _composite();
        }
    }
}

// ---------------------------------------------------------------------------
// Inlet 1: incoming frame-info list (Approach 2)
// ---------------------------------------------------------------------------

function list() {
    if (inlet !== 1) { return; }
    var args  = arrayfromargs(arguments);
    var entry = _parseFrameList(args);
    if (!entry) {
        outlet(5, "video_hub: malformed frame list");
        return;
    }
    var id = String(entry.trackId);
    if (!layers.hasOwnProperty(id)) {
        // Auto-register unknown tracks
        layers[id] = entry;
    } else {
        // Merge new data into existing entry
        for (var k in entry) {
            if (entry.hasOwnProperty(k)) {
                layers[id][k] = entry[k];
            }
        }
    }
    _composite();
}

// ---------------------------------------------------------------------------
// Inlet 3: OSC message (Approach 4)
// ---------------------------------------------------------------------------

function msg_int(v) { /* unused */ }
function msg_float(v) { /* unused */ }

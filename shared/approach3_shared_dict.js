/**
 * approach3_shared_dict.js  –  Approach 3: Shared Dictionary (dict)
 *
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Max's `dict` object supports *named* dictionaries that are accessible from
 * any patch in the same Max session.  A source device writes the current
 * VideoFrameInfo into a rack-scoped named dict; FX and Hub devices subscribe
 * to the dict using [dict.view] or poll it on every metro tick.
 *
 *   Source  → writes to  [dict m4lv_<rackId>_state]
 *   FX/Hub  ← reads from [dict m4lv_<rackId>_state] via [dict.view] notify
 *
 * The dict stores all VideoFrameInfo fields plus the per-FX effect parameters
 * so each FX device can write its output back into the same dict under its own
 * key, enabling the Hub to collect all layers from a single dict.
 *
 * ADVANTAGES
 *  + Structured, self-describing data (JSON-like)
 *  + Supports hierarchical data: per-track, per-clip, per-fx namespacing
 *  + [dict.view] provides automatic change notification — no polling needed
 *  + Easy to inspect at runtime via the Max dict editor
 *
 * DISADVANTAGES
 *  – dict access has some overhead per lookup; not ideal for per-frame pixel
 *    operations (use alongside Approach 1 for pixel data)
 *  – Dictionary is session-global; name collisions possible across projects
 *    (mitigated by using the rackId in the name)
 *
 * MAX PATCH WIRING (pseudo-diagram)
 * ─────────────────────────────────
 * SOURCE SIDE
 *   [js approach3_shared_dict.js]
 *     |  (outlet 0 – dict name)   (outlet 1 – key-value pairs to store)
 *   [dict m4lv_<rackId>_state]
 *
 * RECEIVER SIDE
 *   [dict.view m4lv_<rackId>_state]
 *     |  (notify bang on change)
 *   [js approach3_shared_dict.js]  ← call readDict
 *     |  (outlet 2 – parsed fields)
 */

// ---------------------------------------------------------------------------
// Inlets / Outlets
// ---------------------------------------------------------------------------
inlets  = 2;   // 0 = control, 1 = dict change notification
outlets = 3;   // 0 = dict name, 1 = dict write commands, 2 = parsed fields

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var rackId   = "default";
var trackId  = "";
var dictName = "m4lv_default_state";

// ---------------------------------------------------------------------------
// Max Dict API wrapper
// ---------------------------------------------------------------------------
// Max's js objects can interact with dict natively via the Dict constructor.
// We wrap it here so the patch can call functions directly.

function setRackId(id) {
    rackId   = String(id);
    dictName = "m4lv_" + rackId + "_state";
    outlet(0, dictName);
}

function setTrackId(id) {
    trackId = String(id);
}

// ---------------------------------------------------------------------------
// Write a VideoFrameInfo into the shared dict.
// Call from source device after computing the current frame.
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
function writeFrame(clipId, playheadTime, clipStartTime, clipLength,
                    localTime, filePath, frameRate, frameIndex,
                    width, height, layer) {
    var d = new Dict(dictName);

    // Namespace by trackId so multiple sources can coexist in the same dict
    var prefix = "tracks/" + trackId + "/";

    d.set(prefix + "clipId",        clipId);
    d.set(prefix + "playheadTime",  playheadTime);
    d.set(prefix + "clipStartTime", clipStartTime);
    d.set(prefix + "clipLength",    clipLength);
    d.set(prefix + "localTime",     localTime);
    d.set(prefix + "filePath",      filePath);
    d.set(prefix + "frameRate",     frameRate);
    d.set(prefix + "frameIndex",    frameIndex);
    d.set(prefix + "width",         width);
    d.set(prefix + "height",        height);
    d.set(prefix + "layer",         layer);
    d.set(prefix + "transform/x",        0);
    d.set(prefix + "transform/y",        0);
    d.set(prefix + "transform/scaleX",   1.0);
    d.set(prefix + "transform/scaleY",   1.0);
    d.set(prefix + "transform/rotation", 0);
    d.set(prefix + "transform/opacity",  1.0);

    outlet(0, dictName);
    outlet(1, "written", trackId);
}

// ---------------------------------------------------------------------------
// Write FX parameters into the shared dict (called by video_fx device).
// FX output is stored under tracks/<trackId>/effects/<fxName>/
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string} fxName   - Unique name for this FX instance
 * @param {string} key      - Parameter name
 * @param {number} value    - Parameter value
 */
function writeFxParam(fxName, key, value) {
    var d      = new Dict(dictName);
    var prefix = "tracks/" + trackId + "/effects/" + fxName + "/";
    d.set(prefix + key, value);
    outlet(0, dictName);
    outlet(1, "fx_written", fxName, key, value);
}

// ---------------------------------------------------------------------------
// Read back the dict for a given trackId and emit parsed fields.
// Call from FX or Hub device in response to a [dict.view] notification.
// ---------------------------------------------------------------------------

/**
 * @param {string} srcTrackId - Track whose frame info to read
 */
function readFrame(srcTrackId) {
    var d      = new Dict(dictName);
    var prefix = "tracks/" + srcTrackId + "/";

    outlet(2, "clipId",        d.get(prefix + "clipId"));
    outlet(2, "playheadTime",  d.get(prefix + "playheadTime"));
    outlet(2, "clipStartTime", d.get(prefix + "clipStartTime"));
    outlet(2, "clipLength",    d.get(prefix + "clipLength"));
    outlet(2, "localTime",     d.get(prefix + "localTime"));
    outlet(2, "filePath",      d.get(prefix + "filePath"));
    outlet(2, "frameRate",     d.get(prefix + "frameRate"));
    outlet(2, "frameIndex",    d.get(prefix + "frameIndex"));
    outlet(2, "width",         d.get(prefix + "width"));
    outlet(2, "height",        d.get(prefix + "height"));
    outlet(2, "layer",         d.get(prefix + "layer"));
    outlet(2, "transform",
        d.get(prefix + "transform/x"),
        d.get(prefix + "transform/y"),
        d.get(prefix + "transform/scaleX"),
        d.get(prefix + "transform/scaleY"),
        d.get(prefix + "transform/rotation"),
        d.get(prefix + "transform/opacity"));
}

// ---------------------------------------------------------------------------
// Notification from inlet 1 (dict.view change)
// ---------------------------------------------------------------------------
function bang() {
    if (inlet === 1) {
        // Re-read our own track's entry
        readFrame(trackId);
    }
}

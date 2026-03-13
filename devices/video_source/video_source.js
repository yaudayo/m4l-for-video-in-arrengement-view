/**
 * video_source.js  –  video_source device (M4L "synthesizer" role)
 *
 * ONE PER TRACK.  This device sits in a Max for Live Audio/MIDI Effect Rack
 * on a track and acts as the entry point for all video information on that
 * track.  Like an audio synthesizer it *generates* the primary signal —
 * in this case a VideoFrameInfo describing which video file/frame is active
 * at the current playhead position.
 *
 * RESPONSIBILITIES
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Monitor the Ableton Live API for the currently playing clip on this track.
 * 2. Compute the correct frame index from the clip's playback position.
 * 3. Broadcast the VideoFrameInfo to the rack using ALL five sharing approaches
 *    so that downstream FX and Hub devices can choose whichever method suits
 *    their architecture.
 * 4. Send OSC "frame-ready" notifications so external video renderers can pull
 *    pixel data from the named Jitter matrix.
 *
 * LIVE API INTEGRATION
 * ─────────────────────────────────────────────────────────────────────────────
 * The device uses a `live.observer` (wired externally in the .maxpat) to watch:
 *   live_set tracks <N> playing_slot_index   → detects clip start/stop
 *   live_set tracks <N> playing_position     → current playhead within clip
 *
 * MAX PATCH INLETS/OUTLETS (wiring expected by the .maxpat)
 * ─────────────────────────────────────────────────────────────────────────────
 * Inlets
 *   0 – messages: setRackId, setTrackId, setFilePath, bang (manual refresh)
 *   1 – playing_position float (from live.observer)
 *   2 – playing_slot_index int (from live.observer)
 *
 * Outlets
 *   0 – matrix name (Approach 1: for downstream jit.matrix)
 *   1 – frame-info list (Approach 2: for downstream send objects)
 *   2 – dict name (Approach 3: dict has been updated)
 *   3 – OSC message list (Approach 4: for udpsend)
 *   4 – param name + value pairs (Approach 5: for pattrstorage)
 *   5 – status / error string
 */

// ---------------------------------------------------------------------------
// Inlets / Outlets
// ---------------------------------------------------------------------------
inlets  = 3;
outlets = 6;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var rackId   = "default";
var trackId  = "";
var filePath = "";
var frameRate     = 30;
var videoWidth    = 1920;
var videoHeight   = 1080;
var layer         = 0;

// Current playback state (updated by Live API observers)
var playingSlotIndex = -1;  // -1 = nothing playing
var playingPosition  = 0;   // seconds within clip

// Current clip info (populated when slot changes)
var currentClipId        = "";
var currentClipStartTime = 0;   // arrangement start time of the clip (seconds)
var currentClipLength    = 0;   // clip duration (seconds)

// Approach helpers (instantiated lazily when rackId is known)
var _matrixName = "m4lv_default_matrix";
var _channel    = "m4lv_default_frame";
var _dictName   = "m4lv_default_state";
var _oscPort    = 9000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _updateNames() {
    _matrixName = "m4lv_" + rackId + "_matrix";
    _channel    = "m4lv_" + rackId + "_frame";
    _dictName   = "m4lv_" + rackId + "_state";
    _oscPort    = 9000 + (parseInt(rackId, 10) % 1000 || 0);
}

/** Compute zero-based frame index from seconds. */
function _frameIndex(seconds) {
    return Math.floor(seconds * frameRate);
}

/** Broadcast current state on all five approaches. */
function _broadcast() {
    if (!filePath) {
        outlet(5, "video_source: no file path set");
        return;
    }
    if (playingSlotIndex < 0) {
        return; // nothing playing
    }

    var fi = _frameIndex(playingPosition);

    // ---- Approach 1: Named Matrix ----
    // Just emit the name; the actual pixel write happens via jit.qt.movie
    // in the .maxpat.  This outlet tells connected jit.matrix objects which
    // named matrix to synchronise with.
    outlet(0, _matrixName);

    // ---- Approach 2: send / receive ----
    outlet(1, [
        trackId, currentClipId,
        playingPosition,       // playheadTime (== localTime here)
        currentClipStartTime,
        currentClipLength,
        playingPosition,       // localTime
        filePath, frameRate, fi,
        videoWidth, videoHeight, layer,
        0, 0, 1.0, 1.0, 0, 1.0  // default transform
    ]);

    // ---- Approach 3: Shared Dict ----
    // Write into the named dict so FX/Hub can read it
    _writeToDict(fi);
    outlet(2, _dictName);

    // ---- Approach 4: OSC ----
    outlet(3, [
        "/m4lv/" + rackId + "/frame",
        trackId, currentClipId,
        playingPosition, currentClipStartTime, currentClipLength, playingPosition,
        filePath, frameRate, fi,
        videoWidth, videoHeight, layer,
        0, 0, 1.0, 1.0, 0, 1.0
    ]);

    // ---- Approach 5: pattr ----
    // Emit layer and timeOffset as Live-automatable parameters
    outlet(4, "layer", layer);
    outlet(4, "timeOffset", 0);
}

function _writeToDict(fi) {
    var d      = new Dict(_dictName);
    var prefix = "tracks/" + trackId + "/";
    d.set(prefix + "clipId",        currentClipId);
    d.set(prefix + "playheadTime",  playingPosition);
    d.set(prefix + "clipStartTime", currentClipStartTime);
    d.set(prefix + "clipLength",    currentClipLength);
    d.set(prefix + "localTime",     playingPosition);
    d.set(prefix + "filePath",      filePath);
    d.set(prefix + "frameRate",     frameRate);
    d.set(prefix + "frameIndex",    fi);
    d.set(prefix + "width",         videoWidth);
    d.set(prefix + "height",        videoHeight);
    d.set(prefix + "layer",         layer);
}

// ---------------------------------------------------------------------------
// Inlet 0: control messages
// ---------------------------------------------------------------------------

function setRackId(id) {
    rackId = String(id);
    _updateNames();
    outlet(5, "video_source rack: " + rackId);
}

function setTrackId(id) {
    trackId = String(id);
    outlet(5, "video_source track: " + trackId);
}

function setFilePath(path) {
    filePath = String(path);
    outlet(5, "video_source file: " + filePath);
}

function setFrameRate(fps) {
    frameRate = parseFloat(fps) || 30;
}

function setDimensions(w, h) {
    videoWidth  = parseInt(w, 10) || 1920;
    videoHeight = parseInt(h, 10) || 1080;
}

function setLayer(n) {
    layer = parseInt(n, 10) || 0;
}

function setClipInfo(clipId, startTime, length) {
    currentClipId        = String(clipId);
    currentClipStartTime = parseFloat(startTime) || 0;
    currentClipLength    = parseFloat(length)    || 0;
}

function bang() {
    _broadcast();
}

// ---------------------------------------------------------------------------
// Inlet 1: playing_position (float, seconds within clip)
// ---------------------------------------------------------------------------

function msg_float(v) {
    if (inlet === 1) {
        playingPosition = v;
        _broadcast();
    }
}

// ---------------------------------------------------------------------------
// Inlet 2: playing_slot_index (int; -1 = nothing playing)
// ---------------------------------------------------------------------------

function msg_int(v) {
    if (inlet === 2) {
        playingSlotIndex = v;
        if (v < 0) {
            outlet(5, "video_source: playback stopped");
        }
    }
}

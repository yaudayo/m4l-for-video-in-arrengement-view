/**
 * approach5_pattr.js  –  Approach 5: pattr / autopattr parameter system
 *
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Max's `pattr` (parameter attribute) system is the same mechanism that
 * Ableton uses to expose Live device parameters for automation.  When a
 * pattr object is given a name it can be linked across patches by using
 * a `pattrstorage` with a shared client name, or by using `pattrforward`
 * to route messages between named pattrspaces.
 *
 * For video devices the pattr approach is best suited to *control parameters*
 * (opacity, scale, rotation, effect amounts) rather than raw video frames.
 * The workflow is:
 *
 *   1. Each device registers its automatable parameters with Live via
 *      `live.parameter~` / `live.text` / `live.dial` objects exposed in
 *      the device's `autopattr`.
 *   2. A `pattrstorage` named after the rack stores and restores all values
 *      when a Live Set is saved/loaded.
 *   3. The video_hub device binds to the same `pattrstorage` and reads the
 *      current opacity/layer/transform values for each track during rendering.
 *
 * This JavaScript layer provides helpers to:
 *   a) Build the initial parameter dictionary that autopattr can read
 *   b) Apply incoming parameter changes to a local state object
 *   c) Subscribe to change notifications from the pattrstorage
 *
 * ADVANTAGES
 *  + Seamlessly integrates with Live's automation lanes
 *  + Parameters persist across Save/Load of the Live Set
 *  + Works with Live's MIDI mapping and modulation system
 *  + Zero network overhead — all in-process
 *
 * DISADVANTAGES
 *  – Handles control parameters only (not pixel data or file paths)
 *  – Values are per-parameter scalars; complex structures need multiple pattrss
 *  – pattrstorage name collisions across Sets require careful naming
 *
 * MAX PATCH WIRING (pseudo-diagram)
 * ─────────────────────────────────
 *   [autopattr]
 *     |
 *   [pattrstorage m4lv_<rackId>_params @greedy 1 @autoread 1 @autosave 1]
 *     |  (clientname bang on param change)
 *   [js approach5_pattr.js]  ← inlet 1 receives change notifications
 *     |  (outlet 0 – updated param name+value)
 */

// ---------------------------------------------------------------------------
// Inlets / Outlets
// ---------------------------------------------------------------------------
inlets  = 2;   // 0 = control, 1 = pattrstorage change notifications
outlets = 2;   // 0 = param updates, 1 = status

// ---------------------------------------------------------------------------
// Default parameter set
// Each entry: { name, defaultValue, min, max, unit }
// ---------------------------------------------------------------------------
var PARAM_DEFS = [
    // Transform
    { name: "opacity",   defaultValue: 1.0,  min: 0.0, max: 1.0,   unit: "" },
    { name: "scaleX",    defaultValue: 1.0,  min: 0.1, max: 4.0,   unit: "" },
    { name: "scaleY",    defaultValue: 1.0,  min: 0.1, max: 4.0,   unit: "" },
    { name: "posX",      defaultValue: 0.0,  min: -1920, max: 1920, unit: "px" },
    { name: "posY",      defaultValue: 0.0,  min: -1080, max: 1080, unit: "px" },
    { name: "rotation",  defaultValue: 0.0,  min: -180, max: 180,  unit: "deg" },
    // Layer
    { name: "layer",     defaultValue: 0,    min: 0,   max: 127,   unit: "" },
    // Blend / mix
    { name: "blendMode", defaultValue: 0,    min: 0,   max: 7,     unit: "" }, // 0=over,1=add,2=mult,…
    // Timing offset (shift clip relative to playhead)
    { name: "timeOffset",defaultValue: 0.0,  min: -10, max: 10,    unit: "s" }
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var rackId      = "default";
var trackId     = "";
var storageName = "m4lv_default_params";

/** Current parameter values, keyed by PARAM_DEFS[i].name */
var params = {};

// Initialise from defaults
(function () {
    for (var i = 0; i < PARAM_DEFS.length; i++) {
        params[PARAM_DEFS[i].name] = PARAM_DEFS[i].defaultValue;
    }
}());

// ---------------------------------------------------------------------------
// Control inlet (inlet 0)
// ---------------------------------------------------------------------------

function setRackId(id) {
    rackId      = String(id);
    storageName = "m4lv_" + rackId + "_params";
    outlet(1, "pattrstorage name: " + storageName);
}

function setTrackId(id) {
    trackId = String(id);
}

/**
 * Output the full parameter spec so the patch can create live.dial / live.text
 * objects dynamically via [js] → [thispatcher] → [newobj live.dial …].
 */
function getParamDefs() {
    for (var i = 0; i < PARAM_DEFS.length; i++) {
        var d = PARAM_DEFS[i];
        outlet(0, "paramdef", d.name, d.defaultValue, d.min, d.max, d.unit);
    }
}

/**
 * Get the current value of a named parameter.
 * @param {string} name
 */
function getParam(name) {
    if (params.hasOwnProperty(name)) {
        outlet(0, name, params[name]);
    } else {
        outlet(1, "unknown param: " + name);
    }
}

/**
 * Set a parameter value programmatically (e.g. from an FX device).
 * @param {string} name
 * @param {number} value
 */
function setParam(name, value) {
    if (params.hasOwnProperty(name)) {
        params[name] = value;
        outlet(0, name, value);
    } else {
        outlet(1, "unknown param: " + name);
    }
}

// ---------------------------------------------------------------------------
// Notification from pattrstorage (inlet 1)
// pattrstorage sends: <clientname> <paramname> <value>
// ---------------------------------------------------------------------------

function msg_int(v) {
    _handleParamChange(arguments);
}

function msg_float(v) {
    _handleParamChange(arguments);
}

function _handleParamChange(args) {
    if (inlet !== 1) { return; }
    // args[0] may be the param name when using pattrforward
    var name  = String(args[0]);
    var value = args[1];
    if (params.hasOwnProperty(name)) {
        params[name] = value;
        outlet(0, name, value);
    }
}

/**
 * Dump all current parameter values (useful on loadbang).
 */
function dumpAll() {
    for (var key in params) {
        if (params.hasOwnProperty(key)) {
            outlet(0, key, params[key]);
        }
    }
}

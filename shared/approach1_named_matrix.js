/**
 * approach1_named_matrix.js  –  Approach 1: Named Jitter Matrix (jit.shared)
 *
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Ableton Live / Max for Live shares the same Max application instance for all
 * devices in a session.  The Jitter subsystem lets two (or more) jit.matrix
 * objects share the *same underlying memory* by giving them the same name.
 *
 *   [jit.matrix 4 char 1920 1080 @name m4lv_<rackId>_matrix]
 *
 * Once a source device writes an ARGB frame into the named matrix every other
 * device that opens a jit.matrix with the same name sees the new data without
 * any copy.
 *
 * This JavaScript helper (loaded by the `js` object inside a .maxpat) provides
 * the bookkeeping layer: it tells downstream Max objects which matrix name to
 * open and triggers a bang so they refresh their display.
 *
 * ADVANTAGES
 *  + Zero-copy within the Max process — ideal for HD video
 *  + No serialisation overhead
 *  + Works natively with all Jitter render nodes
 *
 * DISADVANTAGES
 *  – Requires both devices to live in the same Max application instance
 *    (always true for M4L, but means this cannot span two computers)
 *  – Matrix dimensions must be agreed upon at creation time
 *
 * MAX PATCH WIRING (pseudo-diagram)
 * ─────────────────────────────────
 *   [js approach1_named_matrix.js]
 *     |  (outlet 0 – matrix name string)
 *   [jit.matrix 4 char 1920 1080]   ← opens the named shared matrix
 *     |
 *   [jit.window] / [jit.gl.render] …
 */

// ---------------------------------------------------------------------------
// Inlets / Outlets declaration (Max js API)
// ---------------------------------------------------------------------------
inlets  = 2;   // 0 = messages (init, bang, setRackId), 1 = raw frame bang
outlets = 3;   // 0 = matrix name, 1 = bang to refresh, 2 = status string

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
var rackId     = "default";
var matrixName = "m4lv_default_matrix";

// ---------------------------------------------------------------------------
// Max inlet handlers
// ---------------------------------------------------------------------------

/**
 * Set the rack ID and recompute the shared matrix name.
 * Call this from a loadbang → message "setRackId <id>" chain.
 *
 * @param {string} id
 */
function setRackId(id) {
    rackId     = String(id);
    matrixName = "m4lv_" + rackId + "_matrix";
    outlet(2, "matrix name set to: " + matrixName);
    // Tell the connected jit.matrix to use (or create) the named shared matrix
    outlet(0, matrixName);
}

/**
 * Trigger a refresh: output the current matrix name and a bang.
 * Connect inlet 0 bang → this function (via Max message "bang").
 */
function bang() {
    outlet(0, matrixName);
    outlet(1, "bang");
}

/**
 * Query the current matrix name without triggering a refresh.
 */
function getMatrixName() {
    outlet(0, matrixName);
}

// ---------------------------------------------------------------------------
// Helper: build the Max message to resize the shared matrix.
// Send the returned list to a jit.matrix @name … object.
// ---------------------------------------------------------------------------

/**
 * Return the attribute message that sets matrix dimensions.
 * Usage in Max patch: [js …] → [route setDimensions] → [jit.matrix]
 *
 * @param {number} w
 * @param {number} h
 * @returns {Array}  e.g. ["dim", 1920, 1080]
 */
function buildDimMessage(w, h) {
    return ["dim", w, h];
}

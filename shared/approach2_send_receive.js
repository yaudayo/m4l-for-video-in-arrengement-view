/**
 * approach2_send_receive.js  –  Approach 2: send / receive message passing
 *
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Max's `send` and `receive` objects can carry any message, including a
 * jit.matrix reference (the `jit_matrix` message type).  Two devices in the
 * same session communicate by agreeing on a channel name derived from the
 * shared rackId.
 *
 *   Source  → [send m4lv_<rackId>_frame]
 *   FX / Hub← [receive m4lv_<rackId>_frame]
 *
 * The source sends either:
 *   a) The raw jit.matrix reference  (for in-process devices)
 *   b) A serialised VideoFrameInfo list  (metadata-only, lightweight)
 *
 * This file handles the *metadata* path (b).  The source encodes a
 * VideoFrameInfo as a flat list and sends it; every downstream device decodes
 * it and decides whether to load / decode the video file at the given frame.
 *
 * ADVANTAGES
 *  + Works across racks and even different tracks in the same session
 *  + No shared memory required — purely message-based
 *  + Easy to monitor / debug (connect a [print] to a [receive …])
 *
 * DISADVANTAGES
 *  – Carries metadata only by default; pixel data must be fetched separately
 *    (combine with Approach 1 for full frames when needed)
 *  – All receivers on the same channel get every message; each must filter
 *    by trackId / clipId if multiple sources share a rack
 *
 * MAX PATCH WIRING (pseudo-diagram)
 * ─────────────────────────────────
 * SOURCE SIDE
 *   [js approach2_send_receive.js]
 *     |  (outlet 0 – channel name)     (outlet 1 – flat frame-info list)
 *   [prepend send] → [route send] → [send m4lv_<rackId>_frame]
 *
 * RECEIVER SIDE
 *   [receive m4lv_<rackId>_frame]
 *     |
 *   [js approach2_send_receive.js]  ← call parseFrameInfo with the list
 *     |  (outlet 2 – parsed VideoFrameInfo dict fields)
 */

// ---------------------------------------------------------------------------
// Inlets / Outlets
// ---------------------------------------------------------------------------
inlets  = 2;   // 0 = control messages, 1 = incoming raw list from receive
outlets = 3;   // 0 = channel name, 1 = encoded list to send, 2 = decoded info

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var rackId  = "default";
var trackId = "";
var channel = "m4lv_default_frame";

// ---------------------------------------------------------------------------
// Control inlet (inlet 0)
// ---------------------------------------------------------------------------

function setRackId(id) {
    rackId  = String(id);
    channel = "m4lv_" + rackId + "_frame";
    outlet(0, channel);
}

function setTrackId(id) {
    trackId = String(id);
}

// ---------------------------------------------------------------------------
// Encode a VideoFrameInfo as a flat list and output it for sending.
// Call from source device: encodeFrame(clipId, playheadTime, …)
// ---------------------------------------------------------------------------

/**
 * @param {string} clipId
 * @param {number} playheadTime  seconds
 * @param {number} clipStartTime seconds
 * @param {number} clipLength    seconds
 * @param {number} localTime     seconds inside clip
 * @param {string} filePath
 * @param {number} frameRate
 * @param {number} frameIndex
 * @param {number} width
 * @param {number} height
 * @param {number} layer
 */
function encodeFrame(clipId, playheadTime, clipStartTime, clipLength,
                     localTime, filePath, frameRate, frameIndex,
                     width, height, layer) {
    var list = [
        trackId, clipId,
        playheadTime, clipStartTime, clipLength, localTime,
        filePath, frameRate, frameIndex,
        width, height, layer,
        0, 0, 1.0, 1.0, 0, 1.0   // default transform
    ];
    // outlet 0: the channel name (wire to [prepend send])
    outlet(0, channel);
    // outlet 1: the payload list  (wire to [send m4lv_<rackId>_frame])
    outlet(1, list);
}

// ---------------------------------------------------------------------------
// Decode a flat list arriving at inlet 1 (from a [receive …] object).
// ---------------------------------------------------------------------------

/**
 * Called when a list arrives at inlet 1.
 * Outputs named fields on outlet 2 for easy routing with [route].
 */
function list() {
    if (inlet !== 1) { return; }
    var args = arrayfromargs(arguments);
    if (args.length < 18) {
        outlet(2, "error", "short frame-info list: " + args.length + " fields");
        return;
    }
    // Output individual named fields so a [route] in the patch can branch
    outlet(2, "trackId",       args[0]);
    outlet(2, "clipId",        args[1]);
    outlet(2, "playheadTime",  args[2]);
    outlet(2, "clipStartTime", args[3]);
    outlet(2, "clipLength",    args[4]);
    outlet(2, "localTime",     args[5]);
    outlet(2, "filePath",      args[6]);
    outlet(2, "frameRate",     args[7]);
    outlet(2, "frameIndex",    args[8]);
    outlet(2, "width",         args[9]);
    outlet(2, "height",        args[10]);
    outlet(2, "layer",         args[11]);
    outlet(2, "transform",
        args[12], args[13], args[14], args[15], args[16], args[17]);
}

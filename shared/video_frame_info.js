/**
 * video_frame_info.js
 *
 * Shared data structure definition for video frame information passed between
 * M4L devices in a rack.  Loaded by all three device types (video_source,
 * video_fx, video_hub) via the Max js object.
 *
 * A VideoFrameInfo object carries enough metadata for any downstream device to
 * know *which* frame to display and *how* to transform it, without needing to
 * copy raw pixel data on every message.
 */

// ---------------------------------------------------------------------------
// VideoFrameInfo constructor
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}  opts.trackId       - Unique Live track id (Live.Track.id)
 * @param {string}  opts.clipId        - Unique Live clip id  (Live.Clip.id)
 * @param {number}  opts.playheadTime  - Current arrangement playhead in seconds
 * @param {number}  opts.clipStartTime - Clip start time in arrangement (seconds)
 * @param {number}  opts.clipLength    - Clip duration in seconds
 * @param {number}  opts.localTime     - Playhead position inside the clip (seconds)
 * @param {string}  opts.filePath      - Absolute path to the video file
 * @param {number}  opts.frameRate     - Frames per second of the source video
 * @param {number}  opts.frameIndex    - Zero-based frame number to display
 * @param {number}  opts.width         - Frame width in pixels
 * @param {number}  opts.height        - Frame height in pixels
 * @param {number}  opts.layer         - Z-order layer index (higher = front)
 * @param {object}  opts.transform     - Spatial transform parameters
 * @param {object}  opts.effects       - FX parameter bag (keyed by fx name)
 */
function VideoFrameInfo(opts) {
    opts = opts || {};
    this.trackId       = opts.trackId       || "";
    this.clipId        = opts.clipId        || "";
    this.playheadTime  = opts.playheadTime  || 0;
    this.clipStartTime = opts.clipStartTime || 0;
    this.clipLength    = opts.clipLength    || 0;
    this.localTime     = opts.localTime     || 0;
    this.filePath      = opts.filePath      || "";
    this.frameRate     = opts.frameRate     || 30;
    this.frameIndex    = opts.frameIndex    || 0;
    this.width         = opts.width         || 1920;
    this.height        = opts.height        || 1080;
    this.layer         = opts.layer         || 0;
    this.transform     = opts.transform     || {
        x: 0, y: 0,
        scaleX: 1.0, scaleY: 1.0,
        rotation: 0,
        opacity: 1.0
    };
    this.effects       = opts.effects       || {};
}

/**
 * Serialize to a flat list suitable for OSC or send/receive payloads.
 * Field order is stable so receivers can parse positionally.
 *
 * @returns {Array}
 */
VideoFrameInfo.prototype.toList = function () {
    return [
        this.trackId,
        this.clipId,
        this.playheadTime,
        this.clipStartTime,
        this.clipLength,
        this.localTime,
        this.filePath,
        this.frameRate,
        this.frameIndex,
        this.width,
        this.height,
        this.layer,
        this.transform.x,
        this.transform.y,
        this.transform.scaleX,
        this.transform.scaleY,
        this.transform.rotation,
        this.transform.opacity
    ];
};

/**
 * Deserialize from the flat list produced by toList().
 *
 * @param {Array} list
 * @returns {VideoFrameInfo}
 */
VideoFrameInfo.fromList = function (list) {
    return new VideoFrameInfo({
        trackId:       list[0],
        clipId:        list[1],
        playheadTime:  list[2],
        clipStartTime: list[3],
        clipLength:    list[4],
        localTime:     list[5],
        filePath:      list[6],
        frameRate:     list[7],
        frameIndex:    list[8],
        width:         list[9],
        height:        list[10],
        layer:         list[11],
        transform: {
            x:        list[12],
            y:        list[13],
            scaleX:   list[14],
            scaleY:   list[15],
            rotation: list[16],
            opacity:  list[17]
        }
    });
};

/**
 * Serialize to a plain JS object (for use with Max dict).
 *
 * @returns {object}
 */
VideoFrameInfo.prototype.toDict = function () {
    return {
        trackId:       this.trackId,
        clipId:        this.clipId,
        playheadTime:  this.playheadTime,
        clipStartTime: this.clipStartTime,
        clipLength:    this.clipLength,
        localTime:     this.localTime,
        filePath:      this.filePath,
        frameRate:     this.frameRate,
        frameIndex:    this.frameIndex,
        width:         this.width,
        height:        this.height,
        layer:         this.layer,
        transform:     this.transform,
        effects:       this.effects
    };
};

/**
 * Deserialize from a plain JS object (from Max dict).
 *
 * @param {object} obj
 * @returns {VideoFrameInfo}
 */
VideoFrameInfo.fromDict = function (obj) {
    return new VideoFrameInfo(obj);
};

// ---------------------------------------------------------------------------
// Naming helpers used by all sharing approaches
// ---------------------------------------------------------------------------

/**
 * Build a deterministic, rack-scoped name from a rack device id.
 * All devices that share the same rackId can find each other.
 *
 * @param {string} rackId   - Rack device id (Live.Device.id of the rack)
 * @param {string} suffix   - Purpose suffix, e.g. "matrix", "dict", "send"
 * @returns {string}
 */
function sharedName(rackId, suffix) {
    return "m4lv_" + rackId + "_" + suffix;
}

// ---------------------------------------------------------------------------
// Export (Max js objects use inlets/outlets; export via global assignments)
// ---------------------------------------------------------------------------
// When run inside Max's `js` object these variables are available globally.
// In a Node/testing context they are exported via module.exports.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { VideoFrameInfo: VideoFrameInfo, sharedName: sharedName };
}

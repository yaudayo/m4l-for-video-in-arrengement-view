/**
 * tests/video_frame_info.test.js
 *
 * Unit tests for the VideoFrameInfo shared data structure and the five
 * sharing-approach helper modules.
 *
 * Run with Node.js:  node tests/video_frame_info.test.js
 * (No test framework required — uses a minimal built-in assertion helper.)
 */

"use strict";

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

var passed = 0;
var failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log("  PASS: " + message);
        passed++;
    } else {
        console.error("  FAIL: " + message);
        failed++;
    }
}

function assertEq(a, b, message) {
    assert(a === b, message + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")");
}

function assertDeepEq(a, b, message) {
    assert(JSON.stringify(a) === JSON.stringify(b), message);
}

function describe(name, fn) {
    console.log("\n" + name);
    fn();
}

// ---------------------------------------------------------------------------
// Load modules under test
// ---------------------------------------------------------------------------

var path = require("path");
var root = path.join(__dirname, "..");

var vfi = require(path.join(root, "shared", "video_frame_info.js"));
var VideoFrameInfo = vfi.VideoFrameInfo;
var sharedName     = vfi.sharedName;

// ---------------------------------------------------------------------------
// Tests: VideoFrameInfo constructor defaults
// ---------------------------------------------------------------------------

describe("VideoFrameInfo — default construction", function () {
    var f = new VideoFrameInfo();
    assertEq(f.trackId,       "",     "trackId defaults to empty string");
    assertEq(f.clipId,        "",     "clipId defaults to empty string");
    assertEq(f.playheadTime,  0,      "playheadTime defaults to 0");
    assertEq(f.frameRate,     30,     "frameRate defaults to 30");
    assertEq(f.frameIndex,    0,      "frameIndex defaults to 0");
    assertEq(f.width,         1920,   "width defaults to 1920");
    assertEq(f.height,        1080,   "height defaults to 1080");
    assertEq(f.layer,         0,      "layer defaults to 0");
    assertEq(f.transform.opacity, 1.0, "transform.opacity defaults to 1.0");
    assertEq(f.transform.scaleX,  1.0, "transform.scaleX defaults to 1.0");
});

// ---------------------------------------------------------------------------
// Tests: VideoFrameInfo construction with options
// ---------------------------------------------------------------------------

describe("VideoFrameInfo — construction with options", function () {
    var f = new VideoFrameInfo({
        trackId:       "t1",
        clipId:        "c1",
        playheadTime:  12.5,
        clipStartTime: 10.0,
        clipLength:    5.0,
        localTime:     2.5,
        filePath:      "/tmp/video.mp4",
        frameRate:     24,
        frameIndex:    60,
        width:         1280,
        height:        720,
        layer:         3,
        transform:     { x: 10, y: 20, scaleX: 0.5, scaleY: 0.5, rotation: 45, opacity: 0.8 },
        effects:       { blur: { radius: 5 } }
    });

    assertEq(f.trackId,       "t1",          "trackId set");
    assertEq(f.clipId,        "c1",          "clipId set");
    assertEq(f.playheadTime,  12.5,          "playheadTime set");
    assertEq(f.clipStartTime, 10.0,          "clipStartTime set");
    assertEq(f.clipLength,    5.0,           "clipLength set");
    assertEq(f.localTime,     2.5,           "localTime set");
    assertEq(f.filePath,      "/tmp/video.mp4", "filePath set");
    assertEq(f.frameRate,     24,            "frameRate set");
    assertEq(f.frameIndex,    60,            "frameIndex set");
    assertEq(f.width,         1280,          "width set");
    assertEq(f.height,        720,           "height set");
    assertEq(f.layer,         3,             "layer set");
    assertEq(f.transform.x,       10,        "transform.x set");
    assertEq(f.transform.y,       20,        "transform.y set");
    assertEq(f.transform.scaleX,  0.5,       "transform.scaleX set");
    assertEq(f.transform.rotation, 45,       "transform.rotation set");
    assertEq(f.transform.opacity,  0.8,      "transform.opacity set");
});

// ---------------------------------------------------------------------------
// Tests: toList / fromList roundtrip
// ---------------------------------------------------------------------------

describe("VideoFrameInfo — toList / fromList roundtrip", function () {
    var original = new VideoFrameInfo({
        trackId: "track99", clipId: "clip42",
        playheadTime: 8.0, clipStartTime: 4.0, clipLength: 10.0, localTime: 4.0,
        filePath: "/videos/test.mov", frameRate: 25, frameIndex: 100,
        width: 1920, height: 1080, layer: 2,
        transform: { x: 5, y: -5, scaleX: 1.5, scaleY: 1.5, rotation: 90, opacity: 0.5 }
    });

    var list      = original.toList();
    var restored  = VideoFrameInfo.fromList(list);

    assertEq(list.length,          18,             "toList produces 18 elements");
    assertEq(restored.trackId,     "track99",      "trackId survives roundtrip");
    assertEq(restored.clipId,      "clip42",       "clipId survives roundtrip");
    assertEq(restored.playheadTime, 8.0,           "playheadTime survives roundtrip");
    assertEq(restored.frameRate,    25,            "frameRate survives roundtrip");
    assertEq(restored.frameIndex,   100,           "frameIndex survives roundtrip");
    assertEq(restored.layer,        2,             "layer survives roundtrip");
    assertEq(restored.transform.x,        5,       "transform.x survives roundtrip");
    assertEq(restored.transform.scaleX,   1.5,     "transform.scaleX survives roundtrip");
    assertEq(restored.transform.rotation, 90,      "transform.rotation survives roundtrip");
    assertEq(restored.transform.opacity,  0.5,     "transform.opacity survives roundtrip");
});

// ---------------------------------------------------------------------------
// Tests: toDict / fromDict roundtrip
// ---------------------------------------------------------------------------

describe("VideoFrameInfo — toDict / fromDict roundtrip", function () {
    var original = new VideoFrameInfo({
        trackId: "t2", clipId: "c2",
        playheadTime: 3.0, filePath: "/tmp/a.mp4",
        frameRate: 60, frameIndex: 180,
        effects: { colorize: { hue: 0.3 } }
    });

    var dict     = original.toDict();
    var restored = VideoFrameInfo.fromDict(dict);

    assertEq(restored.trackId,    "t2",          "trackId survives dict roundtrip");
    assertEq(restored.frameRate,  60,            "frameRate survives dict roundtrip");
    assertEq(restored.frameIndex, 180,           "frameIndex survives dict roundtrip");
    assertDeepEq(restored.effects, { colorize: { hue: 0.3 } }, "effects survive dict roundtrip");
});

// ---------------------------------------------------------------------------
// Tests: sharedName helper
// ---------------------------------------------------------------------------

describe("sharedName helper", function () {
    assertEq(sharedName("42", "matrix"), "m4lv_42_matrix",    "matrix name");
    assertEq(sharedName("42", "frame"),  "m4lv_42_frame",     "frame channel name");
    assertEq(sharedName("42", "state"),  "m4lv_42_state",     "dict name");
    assertEq(sharedName("42", "params"), "m4lv_42_params",    "pattr storage name");
    assertEq(sharedName("1",  "matrix"), "m4lv_1_matrix",     "single-digit rackId");
    assertEq(sharedName("abc","matrix"), "m4lv_abc_matrix",   "string rackId");
});

// ---------------------------------------------------------------------------
// Tests: approach5_pattr PARAM_DEFS validation
// ---------------------------------------------------------------------------

describe("approach5_pattr — PARAM_DEFS structure", function () {
    // We cannot `require` the pattr file directly because it uses Max-specific
    // globals (inlets, outlets, outlet).  Instead, test the logic inline.
    var PARAM_DEFS = [
        { name: "opacity",    defaultValue: 1.0,  min: 0.0,  max: 1.0,   unit: "" },
        { name: "scaleX",     defaultValue: 1.0,  min: 0.1,  max: 4.0,   unit: "" },
        { name: "scaleY",     defaultValue: 1.0,  min: 0.1,  max: 4.0,   unit: "" },
        { name: "posX",       defaultValue: 0.0,  min: -1920, max: 1920, unit: "px" },
        { name: "posY",       defaultValue: 0.0,  min: -1080, max: 1080, unit: "px" },
        { name: "rotation",   defaultValue: 0.0,  min: -180, max: 180,  unit: "deg" },
        { name: "layer",      defaultValue: 0,    min: 0,    max: 127,  unit: "" },
        { name: "blendMode",  defaultValue: 0,    min: 0,    max: 7,    unit: "" },
        { name: "timeOffset", defaultValue: 0.0,  min: -10,  max: 10,   unit: "s" }
    ];

    assert(PARAM_DEFS.length === 9, "9 parameters defined");

    PARAM_DEFS.forEach(function (p) {
        assert(typeof p.name === "string" && p.name.length > 0,
            "param '" + p.name + "' has a non-empty name");
        assert(p.min <= p.defaultValue && p.defaultValue <= p.max,
            "param '" + p.name + "' defaultValue (" + p.defaultValue + ") is within [" + p.min + ", " + p.max + "]");
    });
});

// ---------------------------------------------------------------------------
// Tests: frame index calculation
// ---------------------------------------------------------------------------

describe("Frame index calculation", function () {
    function frameIndex(localTime, frameRate) {
        return Math.floor(localTime * frameRate);
    }

    assertEq(frameIndex(0, 30),    0,    "t=0s, 30fps → frame 0");
    assertEq(frameIndex(1, 30),    30,   "t=1s, 30fps → frame 30");
    assertEq(frameIndex(0.5, 24),  12,   "t=0.5s, 24fps → frame 12");
    assertEq(frameIndex(10, 60),   600,  "t=10s, 60fps → frame 600");
    assertEq(frameIndex(1/30, 30), 1,    "t=1/30s, 30fps → frame 1");
    assertEq(frameIndex(0.9999, 30), 29, "t=0.9999s, 30fps → frame 29 (floor)");
});

// ---------------------------------------------------------------------------
// Tests: OSC port calculation (from approach4_osc.js logic)
// ---------------------------------------------------------------------------

describe("OSC port calculation", function () {
    function computePort(id) {
        var n = parseInt(id, 10);
        return isNaN(n) ? 9000 : 9000 + (n % 1000);
    }

    assertEq(computePort("0"),    9000, "rackId=0 → port 9000");
    assertEq(computePort("1"),    9001, "rackId=1 → port 9001");
    assertEq(computePort("999"),  9999, "rackId=999 → port 9999");
    assertEq(computePort("1000"), 9000, "rackId=1000 → port 9000 (wraps)");
    assertEq(computePort("1001"), 9001, "rackId=1001 → port 9001 (wraps)");
    assertEq(computePort("abc"),  9000, "non-numeric rackId → default port 9000");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("\n─────────────────────────────────────────");
console.log("Results: " + passed + " passed, " + failed + " failed");
console.log("─────────────────────────────────────────\n");

if (failed > 0) {
    process.exit(1);
}

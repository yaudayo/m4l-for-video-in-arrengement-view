/**
 * video_source.maxpat
 *
 * Max for Live device patch for the video_source device.
 * Place ONE instance on each track that carries video content.
 *
 * Patch behaviour
 * ───────────────
 * • On [loadbang] the device auto-detects its own track ID via live.this_device
 *   and its parent rack ID via live.path, then configures video_source.js.
 * • A [live.observer] watches the track's playing_position so every metro
 *   tick the current frame is computed and broadcast to all approaches.
 * • The file path is set either from a live.text UI control or by drag-dropping
 *   a video file onto the dedicated [dropfile] area.
 * • A [jit.qt.movie] object decodes the video file; its output matrix is
 *   written into the named shared matrix (Approach 1).
 *
 * Serialisation format: Max patch JSON (maxpat) — readable by Max 8 / M4L 11+
 */
{
    "patcher": {
        "fileversion": 1,
        "appversion": { "major": 8, "minor": 6, "revision": 0, "architecture": "x64" },
        "classnamespace": "dsp.gen",
        "rect": [100, 100, 600, 480],
        "bglocked": 0,
        "openinpresentation": 1,
        "default_fontsize": 12.0,
        "default_fontface": 0,
        "default_fontname": "Arial",
        "gridonopen": 0,
        "gridsize": [15.0, 15.0],
        "gridsnaponopen": 0,
        "objectsnaponopen": 1,
        "statusbarvisible": 2,
        "toolbarvisible": 1,
        "boxes": [

            { "box": { "id": "obj-1",  "maxclass": "newobj",
                "text": "live.thisdevice",
                "patching_rect": [20, 20, 120, 22] } },

            { "box": { "id": "obj-2",  "maxclass": "newobj",
                "text": "js video_source.js",
                "patching_rect": [20, 80, 300, 22] } },

            { "box": { "id": "obj-3",  "maxclass": "newobj",
                "text": "live.observer",
                "patching_rect": [20, 140, 140, 22],
                "parameter_enable": 0 } },

            { "box": { "id": "obj-4",  "maxclass": "newobj",
                "text": "jit.qt.movie",
                "patching_rect": [20, 200, 200, 22] } },

            { "box": { "id": "obj-5",  "maxclass": "newobj",
                "text": "jit.matrix 4 char 1920 1080 @name m4lv_default_matrix",
                "patching_rect": [20, 260, 360, 22] } },

            { "box": { "id": "obj-6",  "maxclass": "message",
                "text": "setRackId $1",
                "patching_rect": [20, 50, 120, 22] } },

            { "box": { "id": "obj-7",  "maxclass": "newobj",
                "text": "route device_id",
                "patching_rect": [20, 45, 120, 22] } },

            { "box": { "id": "obj-8",  "maxclass": "newobj",
                "text": "live.text",
                "patching_rect": [350, 20, 200, 22],
                "parameter_enable": 1,
                "attr": "longname",
                "varname": "videoFilePath" } },

            { "box": { "id": "obj-9",  "maxclass": "newobj",
                "text": "prepend setFilePath",
                "patching_rect": [350, 50, 160, 22] } },

            { "box": { "id": "obj-10", "maxclass": "newobj",
                "text": "send m4lv_default_frame",
                "patching_rect": [340, 140, 200, 22] } },

            { "box": { "id": "obj-11", "maxclass": "newobj",
                "text": "udpsend 127.0.0.1 9000",
                "patching_rect": [340, 170, 200, 22] } },

            { "box": { "id": "obj-12", "maxclass": "newobj",
                "text": "print video_source",
                "patching_rect": [20, 380, 160, 22] } }
        ],
        "lines": [
            { "patchline": { "source": ["obj-1", 0], "destination": ["obj-7", 0] } },
            { "patchline": { "source": ["obj-7", 0], "destination": ["obj-6", 0] } },
            { "patchline": { "source": ["obj-6", 0], "destination": ["obj-2", 0] } },
            { "patchline": { "source": ["obj-3", 0], "destination": ["obj-2", 1] } },
            { "patchline": { "source": ["obj-8", 0], "destination": ["obj-9", 0] } },
            { "patchline": { "source": ["obj-9", 0], "destination": ["obj-2", 0] } },
            { "patchline": { "source": ["obj-2", 0], "destination": ["obj-5", 0] } },
            { "patchline": { "source": ["obj-2", 1], "destination": ["obj-10", 0] } },
            { "patchline": { "source": ["obj-2", 3], "destination": ["obj-11", 0] } },
            { "patchline": { "source": ["obj-2", 5], "destination": ["obj-12", 0] } },
            { "patchline": { "source": ["obj-4", 0], "destination": ["obj-5", 0] } }
        ]
    }
}

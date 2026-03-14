/**
 * video_fx.maxpat
 *
 * Max for Live device patch for the video_fx (effects) device.
 * Place after video_source in the same rack, or on any track in the group.
 *
 * Built-in Jitter FX objects wired here:
 *   jit.brcosa    – brightness / contrast / saturation
 *   jit.fastblur  – Gaussian blur
 *   jit.chromakey – chroma-key / green-screen
 *   jit.rota      – rotation and scale
 *
 * Each object is gated by a [selector~]-style toggle so only the active
 * effect type burns cycles.  The output matrix is written into the
 * FX-specific named matrix so the Hub can composite multiple layers.
 */
{
    "patcher": {
        "fileversion": 1,
        "appversion": { "major": 8, "minor": 6, "revision": 0, "architecture": "x64" },
        "classnamespace": "dsp.gen",
        "rect": [100, 100, 700, 560],
        "bglocked": 0,
        "openinpresentation": 1,
        "default_fontsize": 12.0,
        "default_fontface": 0,
        "default_fontname": "Arial",
        "boxes": [

            { "box": { "id": "obj-1",  "maxclass": "newobj",
                "text": "live.thisdevice",
                "patching_rect": [20, 20, 120, 22] } },

            { "box": { "id": "obj-2",  "maxclass": "newobj",
                "text": "js video_fx.js",
                "patching_rect": [20, 80, 300, 22] } },

            { "box": { "id": "obj-3",  "maxclass": "newobj",
                "text": "receive m4lv_default_frame",
                "patching_rect": [20, 140, 220, 22] } },

            { "box": { "id": "obj-4",  "maxclass": "newobj",
                "text": "udpreceive 9000",
                "patching_rect": [260, 140, 140, 22] } },

            { "box": { "id": "obj-5",  "maxclass": "newobj",
                "text": "jit.matrix 4 char 1920 1080 @name m4lv_default_matrix",
                "patching_rect": [20, 200, 360, 22] } },

            { "box": { "id": "obj-6",  "maxclass": "newobj",
                "text": "jit.brcosa",
                "patching_rect": [20, 260, 100, 22] } },

            { "box": { "id": "obj-7",  "maxclass": "newobj",
                "text": "jit.fastblur",
                "patching_rect": [140, 260, 120, 22] } },

            { "box": { "id": "obj-8",  "maxclass": "newobj",
                "text": "jit.chromakey",
                "patching_rect": [280, 260, 120, 22] } },

            { "box": { "id": "obj-9",  "maxclass": "newobj",
                "text": "jit.rota",
                "patching_rect": [420, 260, 100, 22] } },

            { "box": { "id": "obj-10", "maxclass": "newobj",
                "text": "jit.matrix 4 char 1920 1080 @name m4lv_default_matrix_fx",
                "patching_rect": [20, 340, 380, 22] } },

            { "box": { "id": "obj-11", "maxclass": "newobj",
                "text": "send m4lv_default_frame",
                "patching_rect": [420, 340, 200, 22] } },

            { "box": { "id": "obj-12", "maxclass": "newobj",
                "text": "udpsend 127.0.0.1 9000",
                "patching_rect": [420, 370, 200, 22] } },

            { "box": { "id": "obj-13", "maxclass": "newobj",
                "text": "dict.view m4lv_default_state",
                "patching_rect": [20, 50, 200, 22] } },

            { "box": { "id": "obj-14", "maxclass": "newobj",
                "text": "print video_fx",
                "patching_rect": [20, 440, 140, 22] } },

            { "box": { "id": "obj-15", "maxclass": "newobj",
                "text": "live.dial @parameter_longname Brightness @parameter_initial 0",
                "patching_rect": [20, 480, 60, 60],
                "parameter_enable": 1,
                "varname": "brightness" } },

            { "box": { "id": "obj-16", "maxclass": "newobj",
                "text": "live.dial @parameter_longname Opacity @parameter_initial 127",
                "patching_rect": [100, 480, 60, 60],
                "parameter_enable": 1,
                "varname": "opacity" } }
        ],
        "lines": [
            { "patchline": { "source": ["obj-1",  0], "destination": ["obj-2",  0] } },
            { "patchline": { "source": ["obj-3",  0], "destination": ["obj-2",  1] } },
            { "patchline": { "source": ["obj-4",  0], "destination": ["obj-2",  3] } },
            { "patchline": { "source": ["obj-13", 0], "destination": ["obj-2",  2] } },
            { "patchline": { "source": ["obj-2",  0], "destination": ["obj-5",  0] } },
            { "patchline": { "source": ["obj-5",  0], "destination": ["obj-6",  0] } },
            { "patchline": { "source": ["obj-5",  0], "destination": ["obj-7",  0] } },
            { "patchline": { "source": ["obj-5",  0], "destination": ["obj-8",  0] } },
            { "patchline": { "source": ["obj-5",  0], "destination": ["obj-9",  0] } },
            { "patchline": { "source": ["obj-6",  0], "destination": ["obj-10", 0] } },
            { "patchline": { "source": ["obj-2",  1], "destination": ["obj-11", 0] } },
            { "patchline": { "source": ["obj-2",  3], "destination": ["obj-12", 0] } },
            { "patchline": { "source": ["obj-2",  5], "destination": ["obj-14", 0] } },
            { "patchline": { "source": ["obj-15", 0], "destination": ["obj-6",  1] } },
            { "patchline": { "source": ["obj-16", 0], "destination": ["obj-2",  0] } }
        ]
    }
}

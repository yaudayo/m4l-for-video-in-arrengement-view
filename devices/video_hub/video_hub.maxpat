/**
 * video_hub.maxpat
 *
 * Max for Live device patch for the video_hub device.
 * Place on a Group track or the Master track.
 *
 * The Hub collects named Jitter matrices from child tracks, composites
 * them using jit.op @op sfade (alpha-over) and outputs the result matrix.
 *
 * Approach 1 (Named Matrix) is the primary compositing path.
 * Approaches 2-5 carry metadata and control parameters.
 */
{
    "patcher": {
        "fileversion": 1,
        "appversion": { "major": 8, "minor": 6, "revision": 0, "architecture": "x64" },
        "classnamespace": "dsp.gen",
        "rect": [100, 100, 800, 620],
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
                "text": "js video_hub.js",
                "patching_rect": [20, 80, 300, 22] } },

            { "box": { "id": "obj-3",  "maxclass": "newobj",
                "text": "receive m4lv_default_frame",
                "patching_rect": [20, 140, 220, 22] } },

            { "box": { "id": "obj-4",  "maxclass": "newobj",
                "text": "udpreceive 9000",
                "patching_rect": [260, 140, 140, 22] } },

            { "box": { "id": "obj-5",  "maxclass": "newobj",
                "text": "dict.view m4lv_default_state",
                "patching_rect": [420, 140, 200, 22] } },

            { "box": { "id": "obj-6",  "maxclass": "newobj",
                "text": "jit.matrix 4 char 1920 1080 @name m4lv_default_matrix",
                "patching_rect": [20, 200, 360, 22] } },

            { "box": { "id": "obj-7",  "maxclass": "newobj",
                "text": "jit.matrix 4 char 1920 1080 @name m4lv_default_matrix_fx",
                "patching_rect": [20, 240, 370, 22] } },

            { "box": { "id": "obj-8",  "maxclass": "newobj",
                "text": "jit.op @op sfade",
                "patching_rect": [20, 300, 140, 22] } },

            { "box": { "id": "obj-9",  "maxclass": "newobj",
                "text": "jit.matrix 4 char 1920 1080 @name m4lv_default_hub_output",
                "patching_rect": [20, 360, 390, 22] } },

            { "box": { "id": "obj-10", "maxclass": "newobj",
                "text": "send m4lv_default_frame",
                "patching_rect": [440, 360, 200, 22] } },

            { "box": { "id": "obj-11", "maxclass": "newobj",
                "text": "udpsend 127.0.0.1 9000",
                "patching_rect": [440, 390, 200, 22] } },

            { "box": { "id": "obj-12", "maxclass": "newobj",
                "text": "jit.window Video Hub Output @floating 1",
                "patching_rect": [20, 420, 260, 22] } },

            { "box": { "id": "obj-13", "maxclass": "newobj",
                "text": "print video_hub",
                "patching_rect": [300, 460, 140, 22] } },

            { "box": { "id": "obj-14", "maxclass": "newobj",
                "text": "live.dial @parameter_longname Layer_1_Opacity @parameter_initial 127",
                "patching_rect": [20, 500, 60, 60],
                "parameter_enable": 1,
                "varname": "layer1_opacity" } },

            { "box": { "id": "obj-15", "maxclass": "newobj",
                "text": "live.dial @parameter_longname Layer_2_Opacity @parameter_initial 127",
                "patching_rect": [100, 500, 60, 60],
                "parameter_enable": 1,
                "varname": "layer2_opacity" } }
        ],
        "lines": [
            { "patchline": { "source": ["obj-1",  0], "destination": ["obj-2",  0] } },
            { "patchline": { "source": ["obj-3",  0], "destination": ["obj-2",  1] } },
            { "patchline": { "source": ["obj-4",  0], "destination": ["obj-2",  3] } },
            { "patchline": { "source": ["obj-5",  0], "destination": ["obj-2",  2] } },
            { "patchline": { "source": ["obj-6",  0], "destination": ["obj-8",  0] } },
            { "patchline": { "source": ["obj-7",  0], "destination": ["obj-8",  1] } },
            { "patchline": { "source": ["obj-8",  0], "destination": ["obj-9",  0] } },
            { "patchline": { "source": ["obj-9",  0], "destination": ["obj-12", 0] } },
            { "patchline": { "source": ["obj-2",  1], "destination": ["obj-10", 0] } },
            { "patchline": { "source": ["obj-2",  3], "destination": ["obj-11", 0] } },
            { "patchline": { "source": ["obj-2",  5], "destination": ["obj-13", 0] } },
            { "patchline": { "source": ["obj-14", 0], "destination": ["obj-2",  0] } },
            { "patchline": { "source": ["obj-15", 0], "destination": ["obj-2",  0] } }
        ]
    }
}

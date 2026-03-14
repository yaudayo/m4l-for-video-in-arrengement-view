/**
 * approach_gl_texture.js  –  GPU Texture Path (jit.gl.texture sharing)
 *
 * ANSWER TO "動画を扱うのは基本的にテクスチャの状態？"
 * ─────────────────────────────────────────────────────────────────────────────
 * はい — パフォーマンスを最大化するために、動画フレームは**できる限り GPU 上の
 * テクスチャ（VRAM）として扱う**べきです。
 *
 * Yes — for maximum performance, video frames should be kept as GPU textures
 * (VRAM) for as long as possible.  The `jit.gl.texture` object is the Jitter
 * equivalent of `jit.matrix` but lives on the graphics card rather than in
 * CPU RAM.  This module provides the bookkeeping layer for that GPU path.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CPU MATRIX PATH (Approach 1 — jit.matrix)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   [jit.qt.movie]
 *        │ (decoded ARGB frame in CPU RAM, ~8 MB per FHD frame)
 *        ▼
 *   [jit.matrix 4 char 1920 1080 @name …]   ← CPU RAM shared across patches
 *        │
 *   [jit.brcosa]  [jit.fastblur]  [jit.op @op sfade]   ← CPU operations
 *        │
 *   [jit.window]   ← upload to GPU only at the very last step
 *
 *   Cost per frame: decode + CPU FX processing + one GPU upload at output.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GPU TEXTURE PATH (this module — jit.gl.texture)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   [jit.qt.movie]
 *        │ (decoded frame matrix — CPU RAM, brief transit only)
 *        ▼
 *   [jit.gl.texture @name m4lv_<rackId>_tex]   ← upload to VRAM once per frame
 *        │ (texture name — tiny string, stays on GPU from here)
 *        ▼
 *   [jit.gl.videoplane @texture m4lv_<rackId>_tex]   ← position / scale / rotation
 *        │                                              (all GPU operations)
 *   [jit.gl.pix @file fx.jxs]   ← GLSL shader FX (brightness, blur, chroma key…)
 *        │
 *   [jit.gl.render @name m4lv_<rackId>_render]   ← composites all layers on GPU
 *        │
 *   [jit.window]   ← display — GPU never leaves VRAM path
 *
 *   Cost per frame: decode + one GPU upload + GPU-only FX + GPU compositing.
 *   For HD/4K with multiple FX the GPU path is typically 5–20× faster.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NAMED TEXTURE SHARING (analogous to named matrix sharing)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Just as two `jit.matrix @name X` objects share the same CPU memory block,
 * two `jit.gl.texture @name X` objects share the same GPU texture object.
 *
 *   video_source patch:           video_fx patch:
 *   jit.gl.texture @name T ←──→  jit.gl.texture @name T
 *        (writes VRAM)                 (reads VRAM — zero copy)
 *
 * The FX patch does NOT need to re-upload: it just opens the same named
 * texture and reads it with a shader or feeds it to a videoplane.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RENDER CONTEXT SHARING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All objects that share a render context (@name attribute) are composited
 * together by the GPU in one draw call.  This is how the Hub composites
 * multiple video layers without pulling data back to the CPU:
 *
 *   [jit.gl.videoplane @texture m4lv_X_tex @name m4lv_X_render]  (track 1)
 *   [jit.gl.videoplane @texture m4lv_Y_tex @name m4lv_X_render]  (track 2)
 *   [jit.gl.videoplane @texture m4lv_Z_tex @name m4lv_X_render]  (track 3)
 *                       ▲
 *   [jit.gl.render @name m4lv_X_render]  ← one render pass composites all
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GLSL SHADERS FOR FX
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * On the GPU path, Jitter FX objects like `jit.brcosa` and `jit.fastblur` are
 * replaced by GLSL shaders loaded via `jit.gl.pix`:
 *
 *   CPU equivalent       →   GPU shader via jit.gl.pix
 *   ─────────────────────────────────────────────────────
 *   jit.brcosa           →   brcosa.jxs  (built-in Jitter shader)
 *   jit.fastblur         →   fastblur.jxs or gaussian.jxs
 *   jit.chromakey        →   chromakey.jxs
 *   jit.rota             →   jit.gl.videoplane transform params
 *   jit.op @op sfade     →   jit.gl.render with OpenGL alpha blending
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN TO USE EACH PATH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Use GPU texture path when:
 *     • Playing back multiple HD or 4K tracks simultaneously
 *     • Applying real-time FX (blur, color grade, chroma key)
 *     • Compositing three or more layers
 *     • Targeting 60fps output
 *
 *   Use CPU matrix path when:
 *     • Sending pixel data to external software via Syphon / NDI / Spout
 *     • Doing frame-accurate analysis (e.g. histogram, motion detection)
 *     • The system has a weak GPU but a fast multi-core CPU
 *     • Debugging / logging pixel values (CPU RAM is easily inspected)
 *
 *   Hybrid approach (recommended for this project):
 *     Keep video in GPU textures for FX and compositing (this module),
 *     but readback to CPU matrix only when needed for Syphon/NDI output
 *     or pixel analysis.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MAX PATCH INLETS/OUTLETS
 * ─────────────────────────────────────────────────────────────────────────────
 * Inlets
 *   0 – control messages: setRackId, setRenderSize, bang, getTextureName
 *   1 – raw bang from jit.qt.movie (frame decoded, ready to upload)
 *
 * Outlets
 *   0 – texture name string (for jit.gl.texture / jit.gl.videoplane)
 *   1 – render context name string (for jit.gl.render)
 *   2 – bang to trigger jit.gl.render
 *   3 – status / error string
 */

// ---------------------------------------------------------------------------
// Inlets / Outlets declaration (Max js API)
// ---------------------------------------------------------------------------
inlets  = 2;   // 0 = control messages, 1 = decoded-frame bang from jit.qt.movie
outlets = 4;   // 0 = texture name, 1 = render ctx name, 2 = render bang, 3 = status

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
var rackId      = "default";
var textureName = "m4lv_default_tex";
var renderName  = "m4lv_default_render";
var renderW     = 1920;
var renderH     = 1080;

// Registered FX layer descriptors: [{ name, shader, uniforms }]
var _fxChain = [];

// Registered compositing layers: [{ texName, opacity, scaleX, scaleY, tx, ty, rot }]
var _layers  = [];

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

function _updateNames() {
    textureName = "m4lv_" + rackId + "_tex";
    renderName  = "m4lv_" + rackId + "_render";
}

// ---------------------------------------------------------------------------
// Inlet 0: control messages
// ---------------------------------------------------------------------------

/**
 * Set rack ID and recompute all derived names.
 * @param {string} id
 */
function setRackId(id) {
    rackId = String(id);
    _updateNames();
    outlet(3, "gl_texture rack: " + rackId);
    outlet(0, textureName);
    outlet(1, renderName);
}

/**
 * Override the output render resolution.
 * @param {number} w
 * @param {number} h
 */
function setRenderSize(w, h) {
    renderW = parseInt(w, 10) || 1920;
    renderH = parseInt(h, 10) || 1080;
    outlet(3, "render size: " + renderW + "x" + renderH);
}

/**
 * Emit current names without triggering a render.
 */
function getTextureName() {
    outlet(0, textureName);
}

/**
 * Emit current render context name.
 */
function getRenderName() {
    outlet(1, renderName);
}

/**
 * Trigger a render pass: output names and render bang.
 */
function bang() {
    outlet(0, textureName);
    outlet(1, renderName);
    outlet(2, "bang");
}

// ---------------------------------------------------------------------------
// Inlet 1: bang from jit.qt.movie (new decoded frame available)
// ---------------------------------------------------------------------------
// In the .maxpat, jit.qt.movie's bang outlet is connected to inlet 1.
// This triggers the GPU upload and a render pass.

function msg_int(v) {
    if (inlet === 1) {
        // A frame has been decoded and written into the named texture.
        // Trigger a render pass so jit.gl.render redraws.
        outlet(0, textureName);
        outlet(1, renderName);
        outlet(2, "bang");
    }
}

// ---------------------------------------------------------------------------
// FX chain management
// ---------------------------------------------------------------------------

/**
 * Register a GLSL shader FX stage.
 * Each FX stage corresponds to a [jit.gl.pix @file <shader>.jxs @name <fxName>]
 * object in the .maxpat.
 *
 * @param {string} fxName    - Unique name for this FX stage
 * @param {string} shaderFile- Shader filename, e.g. "brcosa.jxs"
 */
function addFx(fxName, shaderFile) {
    var existing = _findFxIndex(fxName);
    var entry = {
        name:     String(fxName),
        shader:   String(shaderFile),
        uniforms: {}
    };
    if (existing >= 0) {
        _fxChain[existing] = entry;
    } else {
        _fxChain.push(entry);
    }
    outlet(3, "gl_texture fx added: " + fxName + " (" + shaderFile + ")");
}

/**
 * Remove a GLSL shader FX stage.
 * @param {string} fxName
 */
function removeFx(fxName) {
    var idx = _findFxIndex(fxName);
    if (idx >= 0) { _fxChain.splice(idx, 1); }
    outlet(3, "gl_texture fx removed: " + fxName);
}

/**
 * Set a uniform parameter on an FX shader.
 * @param {string} fxName
 * @param {string} uniformName
 * @param {number} value
 */
function setFxParam(fxName, uniformName, value) {
    var idx = _findFxIndex(fxName);
    if (idx < 0) {
        outlet(3, "gl_texture: unknown fx: " + fxName);
        return;
    }
    _fxChain[idx].uniforms[String(uniformName)] = parseFloat(value);
}

function _findFxIndex(name) {
    for (var i = 0; i < _fxChain.length; i++) {
        if (_fxChain[i].name === String(name)) { return i; }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Layer management (for Hub compositing)
// ---------------------------------------------------------------------------

/**
 * Register or update a compositing layer.
 * Each layer is rendered by a [jit.gl.videoplane @texture <texName> @name <renderCtx>].
 *
 * @param {string} trackId
 * @param {string} texName   - Named texture produced by that track's video_source
 * @param {number} layerIdx  - Z-order (higher = front)
 * @param {number} opacity
 * @param {number} scaleX
 * @param {number} scaleY
 * @param {number} tx        - Translation X (normalised −1 to 1)
 * @param {number} ty        - Translation Y (normalised −1 to 1)
 * @param {number} rot       - Rotation in degrees
 */
function setLayer(trackId, texName, layerIdx, opacity, scaleX, scaleY, tx, ty, rot) {
    var id = String(trackId);
    var found = false;
    for (var i = 0; i < _layers.length; i++) {
        if (_layers[i].trackId === id) {
            _layers[i] = {
                trackId: id, texName: String(texName),
                layer: parseInt(layerIdx, 10) || 0,
                opacity: parseFloat(opacity) || 1,
                scaleX:  parseFloat(scaleX)  || 1,
                scaleY:  parseFloat(scaleY)  || 1,
                tx:      parseFloat(tx)      || 0,
                ty:      parseFloat(ty)      || 0,
                rot:     parseFloat(rot)     || 0
            };
            found = true;
            break;
        }
    }
    if (!found) {
        _layers.push({
            trackId: id, texName: String(texName),
            layer: parseInt(layerIdx, 10) || 0,
            opacity: parseFloat(opacity) || 1,
            scaleX:  parseFloat(scaleX)  || 1,
            scaleY:  parseFloat(scaleY)  || 1,
            tx:      parseFloat(tx)      || 0,
            ty:      parseFloat(ty)      || 0,
            rot:     parseFloat(rot)     || 0
        });
    }
    outlet(3, "gl_texture layer set: " + id + " tex=" + texName);
}

/**
 * Remove a compositing layer.
 * @param {string} trackId
 */
function removeLayer(trackId) {
    var id = String(trackId);
    _layers = _layers.filter(function (l) { return l.trackId !== id; });
    outlet(3, "gl_texture layer removed: " + id);
}

/**
 * Return sorted layers (back to front) for use in the .maxpat compositor loop.
 * Emits one "layer" message per layer so the patch can drive jit.gl.videoplane.
 *
 * Message format per layer:
 *   ["layer", zIndex, texName, opacity, scaleX, scaleY, tx, ty, rot]
 */
function dumpLayers() {
    var sorted = _layers.slice().sort(function (a, b) { return a.layer - b.layer; });
    for (var i = 0; i < sorted.length; i++) {
        var L = sorted[i];
        outlet(0, "layer", i, L.texName, L.opacity, L.scaleX, L.scaleY, L.tx, L.ty, L.rot);
    }
    outlet(1, renderName);
    outlet(2, "bang");
}

// ---------------------------------------------------------------------------
// Attribute message builders (used by .maxpat via [route] objects)
// ---------------------------------------------------------------------------

/**
 * Build the @dim message for jit.gl.texture to set upload resolution.
 * @param {number} w
 * @param {number} h
 * @returns {Array}  e.g. ["dim", 1920, 1080]
 */
function buildTextureDimMessage(w, h) {
    return ["dim", w || renderW, h || renderH];
}

/**
 * Build the position message for jit.gl.videoplane.
 * @param {number} tx  - normalised X (−1 to 1)
 * @param {number} ty  - normalised Y (−1 to 1)
 * @returns {Array}  e.g. ["position", 0, 0, 0]
 */
function buildPositionMessage(tx, ty) {
    return ["position", parseFloat(tx) || 0, parseFloat(ty) || 0, 0];
}

/**
 * Build the scale message for jit.gl.videoplane.
 * @param {number} sx
 * @param {number} sy
 * @returns {Array}  e.g. ["scale", 1.0, 1.0, 1.0]
 */
function buildScaleMessage(sx, sy) {
    return ["scale", parseFloat(sx) || 1, parseFloat(sy) || 1, 1];
}

/**
 * Build a shader uniform message for jit.gl.pix.
 * @param {string} uniformName
 * @param {number} value
 * @returns {Array}  e.g. ["val_brightness", 0.5]
 */
function buildShaderUniformMessage(uniformName, value) {
    return ["val_" + uniformName, parseFloat(value) || 0];
}

// ---------------------------------------------------------------------------
// Utility: CPU→GPU texture name for a given track
// ─────────────────────────────────────────────────────────────────────────────
// Each track's video_source device creates a texture named:
//   m4lv_<rackId>_tex_<trackId>
// This function builds that name so the Hub can reference it.
// ---------------------------------------------------------------------------

/**
 * @param {string} rId    - Rack ID
 * @param {string} trkId  - Track ID
 * @returns {string}
 */
function trackTextureName(rId, trkId) {
    return "m4lv_" + String(rId) + "_tex_" + String(trkId);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        trackTextureName:         trackTextureName,
        buildTextureDimMessage:   buildTextureDimMessage,
        buildPositionMessage:     buildPositionMessage,
        buildScaleMessage:        buildScaleMessage,
        buildShaderUniformMessage: buildShaderUniformMessage,
        // Expose internal state for testing
        _state: function (mod) {
            // mod must supply rackId, textureName, renderName, _fxChain, _layers
            rackId      = mod.rackId      !== undefined ? mod.rackId      : rackId;
            textureName = mod.textureName !== undefined ? mod.textureName : textureName;
            renderName  = mod.renderName  !== undefined ? mod.renderName  : renderName;
            return { rackId: rackId, textureName: textureName, renderName: renderName,
                     fxChain: _fxChain, layers: _layers };
        }
    };
}

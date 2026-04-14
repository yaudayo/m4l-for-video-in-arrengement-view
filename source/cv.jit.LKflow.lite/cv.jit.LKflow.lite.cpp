/*
cv.jit.LKflow.lite

CPU-based dense optical flow for Max/MSP Jitter, with automatic OpenCL
acceleration on Intel/AMD integrated GPUs (and any OpenCL-capable device)
via OpenCV's Transparent API (cv::UMat).

Uses cv::calcOpticalFlowFarneback, which is the standard CPU dense optical
flow algorithm and is a practical drop-in for cv.jit.LKflow.gpu on hardware
that lacks a CUDA-capable GPU.

Based on cv.jit.LKflow by Jean-Marc Pelletier (jmp@jmpelletier.com).

This file is part of the cv.jit extension collection.

Licensed under the GNU Lesser General Public License v3 or later.
See <http://www.gnu.org/licenses/>.

-----------------------------------------------------------------------
Overview
-----------------------------------------------------------------------
Input  : 1-plane char (8-bit grayscale) Jitter matrix
Output : 2-plane float32 Jitter matrix
           plane 0 = horizontal (x) optical flow per pixel
           plane 1 = vertical   (y) optical flow per pixel

Attributes
  @winsize     Farneback averaging window size  (odd, >= 3, default 13)
  @maxlevel    Pyramid levels                   (0-8,  default 3)
  @iters       Iterations at each pyramid level (1-100, default 10)
  @use_initial Use previous flow as warm start  (0/1,  default 0)

Messages
  reset        Clears the stored previous frame (useful on scene change)

-----------------------------------------------------------------------
Build requirements
-----------------------------------------------------------------------
  - OpenCV 4.x (standard build; no CUDA required)
  - Max SDK (max-sdk-base)
  - OpenCL runtime (optional, for Intel/AMD GPU acceleration via T-API)
*/

#include "cvjit.h"

#include <opencv2/video/tracking.hpp>   // calcOpticalFlowFarneback
#include <opencv2/core/ocl.hpp>         // cv::ocl

using namespace c74::max;

// ---------------------------------------------------------------------------
// Object struct
// Must be POD-compatible because calcoffset() is used in attribute setup.
// Non-POD members (cv:: objects) are stored behind pointers.
// ---------------------------------------------------------------------------
typedef struct _cv_jit_LKflow_lite
{
    t_object    ob;

    // User-facing attributes
    long        winsize;        // Farneback averaging window size (odd, >= 3)
    long        maxlevel;       // Pyramid levels
    long        iters;          // Solver iterations per level
    long        use_initial;    // Warm-start flow from previous frame (0/1)

    // OpenCV objects (heap-allocated to keep the struct POD-ish)
    cv::UMat    *u_prev;        // Previous frame (UMat: CPU or OpenCL memory)
    cv::UMat    *u_flow;        // Previous flow  (for warm-start)
} t_cv_jit_LKflow_lite;

void *_cv_jit_LKflow_lite_class;

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
t_jit_err             cv_jit_LKflow_lite_init(void);
t_cv_jit_LKflow_lite *cv_jit_LKflow_lite_new(void);
void                  cv_jit_LKflow_lite_free(t_cv_jit_LKflow_lite *x);
t_jit_err             cv_jit_LKflow_lite_matrix_calc(t_cv_jit_LKflow_lite *x, void *inputs, void *outputs);
void                  cv_jit_LKflow_lite_reset(t_cv_jit_LKflow_lite *x);

t_jit_err cv_jit_LKflow_lite_set_winsize(t_cv_jit_LKflow_lite *x, void *attr, long ac, t_atom *av);
t_jit_err cv_jit_LKflow_lite_set_maxlevel(t_cv_jit_LKflow_lite *x, void *attr, long ac, t_atom *av);
t_jit_err cv_jit_LKflow_lite_set_iters(t_cv_jit_LKflow_lite *x, void *attr, long ac, t_atom *av);
t_jit_err cv_jit_LKflow_lite_set_use_initial(t_cv_jit_LKflow_lite *x, void *attr, long ac, t_atom *av);

// ---------------------------------------------------------------------------
// Attribute setters — clamp and store; no object to rebuild
// ---------------------------------------------------------------------------

t_jit_err cv_jit_LKflow_lite_set_winsize(t_cv_jit_LKflow_lite *x, void *attr, long ac, t_atom *av)
{
    if (ac < 1) return JIT_ERR_NONE;
    long v = atom_getlong(av);
    if (v < 3)  v = 3;
    if (v > 99) v = 99;
    if ((v & 1) == 0) v += 1;   // must be odd
    x->winsize = v;
    return JIT_ERR_NONE;
}

t_jit_err cv_jit_LKflow_lite_set_maxlevel(t_cv_jit_LKflow_lite *x, void *attr, long ac, t_atom *av)
{
    if (ac < 1) return JIT_ERR_NONE;
    long v = atom_getlong(av);
    if (v < 0) v = 0;
    if (v > 8) v = 8;
    x->maxlevel = v;
    return JIT_ERR_NONE;
}

t_jit_err cv_jit_LKflow_lite_set_iters(t_cv_jit_LKflow_lite *x, void *attr, long ac, t_atom *av)
{
    if (ac < 1) return JIT_ERR_NONE;
    long v = atom_getlong(av);
    if (v < 1)   v = 1;
    if (v > 100) v = 100;
    x->iters = v;
    return JIT_ERR_NONE;
}

t_jit_err cv_jit_LKflow_lite_set_use_initial(t_cv_jit_LKflow_lite *x, void *attr, long ac, t_atom *av)
{
    if (ac < 1) return JIT_ERR_NONE;
    x->use_initial = (atom_getlong(av) != 0) ? 1L : 0L;
    return JIT_ERR_NONE;
}

// ---------------------------------------------------------------------------
// Class initialization
// ---------------------------------------------------------------------------

t_jit_err cv_jit_LKflow_lite_init(void)
{
    // Report OpenCL availability at load time
    if (cv::ocl::haveOpenCL() && cv::ocl::useOpenCL()) {
        cv::ocl::Device dev = cv::ocl::Device::getDefault();
        object_post(nullptr,
            "cv.jit.LKflow.lite: OpenCL available (%s). "
            "Hardware acceleration enabled.",
            dev.name().c_str());
    } else {
        object_post(nullptr,
            "cv.jit.LKflow.lite: OpenCL not available. Running on CPU.");
    }

    long attrflags = ATTR_GET_DEFER_LOW | ATTR_SET_USURP_LOW;
    t_jit_object *attr, *mop;

    _cv_jit_LKflow_lite_class = jit_class_new(
        "cv_jit_LKflow_lite",
        (method)cv_jit_LKflow_lite_new,
        (method)cv_jit_LKflow_lite_free,
        sizeof(t_cv_jit_LKflow_lite),
        A_CANT, 0L
    );

    // Matrix operator: 1 input, 1 output (2-plane float32)
    mop = (t_jit_object *)jit_object_new(_jit_sym_jit_mop, 1, 1);
    jit_mop_single_type(mop, _jit_sym_float32);
    jit_mop_single_planecount(mop, 2);
    jit_class_addadornment(_cv_jit_LKflow_lite_class, mop);

    // Methods
    jit_class_addmethod(_cv_jit_LKflow_lite_class,
        (method)cv_jit_LKflow_lite_matrix_calc, "matrix_calc", A_CANT, 0L);
    jit_class_addmethod(_cv_jit_LKflow_lite_class,
        (method)cv_jit_LKflow_lite_reset, "reset", A_NOTHING, 0L);

    // Attributes

    // winsize: odd integer in [3, 99]
    attr = (t_jit_object *)jit_object_new(_jit_sym_jit_attr_offset,
        "winsize", _jit_sym_long, attrflags,
        (method)0L, (method)cv_jit_LKflow_lite_set_winsize,
        calcoffset(t_cv_jit_LKflow_lite, winsize));
    jit_attr_addfilterset_clip(attr, 3, 99, true, true);
    jit_class_addattr(_cv_jit_LKflow_lite_class, attr);

    // maxlevel: integer in [0, 8]
    attr = (t_jit_object *)jit_object_new(_jit_sym_jit_attr_offset,
        "maxlevel", _jit_sym_long, attrflags,
        (method)0L, (method)cv_jit_LKflow_lite_set_maxlevel,
        calcoffset(t_cv_jit_LKflow_lite, maxlevel));
    jit_attr_addfilterset_clip(attr, 0, 8, true, true);
    jit_class_addattr(_cv_jit_LKflow_lite_class, attr);

    // iters: integer in [1, 100]
    attr = (t_jit_object *)jit_object_new(_jit_sym_jit_attr_offset,
        "iters", _jit_sym_long, attrflags,
        (method)0L, (method)cv_jit_LKflow_lite_set_iters,
        calcoffset(t_cv_jit_LKflow_lite, iters));
    jit_attr_addfilterset_clip(attr, 1, 100, true, true);
    jit_class_addattr(_cv_jit_LKflow_lite_class, attr);

    // use_initial: boolean 0/1
    attr = (t_jit_object *)jit_object_new(_jit_sym_jit_attr_offset,
        "use_initial", _jit_sym_long, attrflags,
        (method)0L, (method)cv_jit_LKflow_lite_set_use_initial,
        calcoffset(t_cv_jit_LKflow_lite, use_initial));
    jit_attr_addfilterset_clip(attr, 0, 1, true, true);
    jit_class_addattr(_cv_jit_LKflow_lite_class, attr);

    jit_class_register(_cv_jit_LKflow_lite_class);
    return JIT_ERR_NONE;
}

// ---------------------------------------------------------------------------
// matrix_calc
// ---------------------------------------------------------------------------

t_jit_err cv_jit_LKflow_lite_matrix_calc(t_cv_jit_LKflow_lite *x, void *inputs, void *outputs)
{
    t_jit_err err = JIT_ERR_NONE;

    void *in_matrix  = jit_object_method(inputs,  _jit_sym_getindex, 0);
    void *out_matrix = jit_object_method(outputs, _jit_sym_getindex, 0);

    if (!x || !in_matrix || !out_matrix) {
        return JIT_ERR_INVALID_PTR;
    }

    void *in_savelock  = jit_object_method(in_matrix,  _jit_sym_lock, 1);
    void *out_savelock = jit_object_method(out_matrix, _jit_sym_lock, 1);

    t_jit_matrix_info in_minfo, out_minfo;
    jit_object_method(in_matrix,  _jit_sym_getinfo, &in_minfo);
    jit_object_method(out_matrix, _jit_sym_getinfo, &out_minfo);

    char *in_bp  = nullptr;
    char *out_bp = nullptr;
    jit_object_method(in_matrix,  _jit_sym_getdata, &in_bp);
    jit_object_method(out_matrix, _jit_sym_getdata, &out_bp);

    if (!in_bp)  { err = JIT_ERR_INVALID_INPUT;  goto out; }
    if (!out_bp) { err = JIT_ERR_INVALID_OUTPUT; goto out; }

    // Input must be 1-plane char, 2D
    if (in_minfo.type != _jit_sym_char || in_minfo.planecount != 1) {
        object_error((t_object *)x,
            "cv.jit.LKflow.lite: input must be 1-plane char (8-bit grayscale)");
        err = JIT_ERR_MISMATCH_TYPE;
        goto out;
    }
    if (in_minfo.dimcount != 2) {
        object_error((t_object *)x,
            "cv.jit.LKflow.lite: input must be a 2D matrix");
        err = JIT_ERR_MISMATCH_DIM;
        goto out;
    }

    {
        int cols = (int)in_minfo.dim[0];
        int rows = (int)in_minfo.dim[1];

        // Wrap the Jitter input buffer as a cv::Mat (zero-copy), then upload
        // to a UMat so that OpenCV's T-API can dispatch to OpenCL when available.
        cv::Mat h_current_ref(rows, cols, CV_8UC1, in_bp,
                              static_cast<size_t>(in_minfo.dimstride[1]));

        try {
            cv::UMat u_current;
            h_current_ref.copyTo(u_current);    // CPU→OpenCL device if available

            // On first call or after reset/resize: store current frame, output zeros.
            bool size_changed = (!x->u_prev->empty() &&
                                 (x->u_prev->cols != cols || x->u_prev->rows != rows));

            if (x->u_prev->empty() || size_changed) {
                u_current.copyTo(*x->u_prev);
                x->u_flow->release();

                t_jit_matrix_info new_out = out_minfo;
                new_out.dim[0]     = cols;
                new_out.dim[1]     = rows;
                new_out.planecount = 2;
                new_out.type       = _jit_sym_float32;
                jit_object_method(out_matrix, _jit_sym_setinfo, &new_out);
                jit_object_method(out_matrix, _jit_sym_clear);
                goto out;
            }

            // ----------------------------------------------------------------
            // Dense Farneback optical flow
            //   pyr_scale  0.5  — classic half-resolution pyramid
            //   poly_n     5    — polynomial neighbourhood (5 or 7)
            //   poly_sigma 1.1  — Gaussian sigma for poly smoothing
            // ----------------------------------------------------------------
            int flags = 0;
            if (x->use_initial && !x->u_flow->empty() &&
                x->u_flow->cols == cols && x->u_flow->rows == rows)
            {
                flags |= cv::OPTFLOW_USE_INITIAL_FLOW;
            }

            cv::calcOpticalFlowFarneback(
                *x->u_prev,             // previous frame
                u_current,              // current  frame
                *x->u_flow,             // output/in-out flow (CV_32FC2)
                0.5,                    // pyr_scale
                (int)x->maxlevel,       // levels
                (int)x->winsize,        // winsize
                (int)x->iters,          // iterations
                5,                      // poly_n
                1.1,                    // poly_sigma
                flags
            );

            // Download result to host for copying into Jitter output
            cv::Mat h_flow;
            x->u_flow->copyTo(h_flow);  // CV_32FC2

            // ----------------------------------------------------------------
            // Resize output Jitter matrix if needed
            // ----------------------------------------------------------------
            if (out_minfo.dim[0] != cols || out_minfo.dim[1] != rows ||
                out_minfo.planecount != 2 || out_minfo.type != _jit_sym_float32)
            {
                t_jit_matrix_info new_out = out_minfo;
                new_out.dim[0]     = cols;
                new_out.dim[1]     = rows;
                new_out.planecount = 2;
                new_out.type       = _jit_sym_float32;
                jit_object_method(out_matrix, _jit_sym_setinfo, &new_out);
                jit_object_method(out_matrix, _jit_sym_getinfo, &out_minfo);
                jit_object_method(out_matrix, _jit_sym_getdata, &out_bp);
                if (!out_bp) { err = JIT_ERR_INVALID_OUTPUT; goto out; }
            }

            // ----------------------------------------------------------------
            // Copy h_flow (CV_32FC2, interleaved) into the Jitter output.
            // Jitter 2-plane float32 is also interleaved (p0,p1,p0,p1,...),
            // so both layouts match. We copy row by row to respect strides.
            // ----------------------------------------------------------------
            for (int row = 0; row < rows; row++) {
                float            *dst = reinterpret_cast<float *>(
                                            out_bp + row * out_minfo.dimstride[1]);
                const cv::Vec2f  *src = h_flow.ptr<cv::Vec2f>(row);

                for (int col = 0; col < cols; col++) {
                    dst[0] = src[col][0];   // x (horizontal) flow
                    dst[1] = src[col][1];   // y (vertical) flow
                    dst   += 2;
                }
            }

            // Advance: current frame becomes previous frame
            u_current.copyTo(*x->u_prev);

        } catch (const cv::Exception &e) {
            object_error((t_object *)x,
                "cv.jit.LKflow.lite: OpenCV error: %s", e.what());
            err = JIT_ERR_GENERIC;
        }
    }

out:
    jit_object_method(out_matrix, gensym("lock"), out_savelock);
    jit_object_method(in_matrix,  gensym("lock"), in_savelock);
    return err;
}

// ---------------------------------------------------------------------------
// reset message — clears the stored previous frame and flow
// ---------------------------------------------------------------------------

void cv_jit_LKflow_lite_reset(t_cv_jit_LKflow_lite *x)
{
    if (!x) return;
    if (x->u_prev)  x->u_prev->release();
    if (x->u_flow)  x->u_flow->release();
}

// ---------------------------------------------------------------------------
// Constructor / Destructor
// ---------------------------------------------------------------------------

t_cv_jit_LKflow_lite *cv_jit_LKflow_lite_new(void)
{
    t_cv_jit_LKflow_lite *x =
        (t_cv_jit_LKflow_lite *)jit_object_alloc(_cv_jit_LKflow_lite_class);

    if (x) {
        x->winsize      = 13;
        x->maxlevel     = 3;
        x->iters        = 10;
        x->use_initial  = 0;

        x->u_prev = new cv::UMat();
        x->u_flow = new cv::UMat();
    }

    return x;
}

void cv_jit_LKflow_lite_free(t_cv_jit_LKflow_lite *x)
{
    delete x->u_prev;
    delete x->u_flow;
}

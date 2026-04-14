/*
cv.jit.LKflow.gpu

GPU-accelerated dense Lucas-Kanade optical flow for Max/MSP Jitter.
Uses cv::cuda::DensePyrLKOpticalFlow from OpenCV CUDA modules.

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
  @winsize     Lucas-Kanade search window size (odd, >= 3, default 13)
  @maxlevel    Maximum pyramid level            (0-8,  default 3)
  @iters       Number of solver iterations      (1-100, default 30)
  @use_initial Use previous flow as warm start  (0/1,  default 0)

Messages
  reset        Clears the stored previous frame (useful on scene change)

-----------------------------------------------------------------------
Build requirements
-----------------------------------------------------------------------
  - OpenCV 4.x with the opencv_cudaoptflow and opencv_cudaarithm
    modules compiled in (requires a CUDA-capable build of OpenCV 4)
  - Max SDK (max-sdk-base)
  - A CUDA-capable GPU at runtime (no crash if absent; error posted)
*/

#include "cvjit.h"

#include <opencv2/core/cuda.hpp>
#include <opencv2/cudaoptflow.hpp>
#include <opencv2/cudaarithm.hpp>

using namespace c74::max;

// ---------------------------------------------------------------------------
// Object struct
// Must be POD-compatible because calcoffset() is used in attribute setup.
// Non-POD members (cv:: objects) are stored behind pointers.
// ---------------------------------------------------------------------------
typedef struct _cv_jit_LKflow_gpu
{
    t_object    ob;

    // User-facing attributes
    long        winsize;        // LK window half-size (odd, >= 3)
    long        maxlevel;       // Pyramid depth
    long        iters;          // Solver iterations
    long        use_initial;    // Warm-start from previous flow (0/1)

    // OpenCV CUDA objects (heap-allocated to keep the struct POD-ish)
    cv::cuda::GpuMat                            *d_prev;    // Previous frame on GPU
    cv::Ptr<cv::cuda::DensePyrLKOpticalFlow>    *d_lkflow;  // LK flow calculator
} t_cv_jit_LKflow_gpu;

void *_cv_jit_LKflow_gpu_class;

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
t_jit_err            cv_jit_LKflow_gpu_init(void);
t_cv_jit_LKflow_gpu *cv_jit_LKflow_gpu_new(void);
void                 cv_jit_LKflow_gpu_free(t_cv_jit_LKflow_gpu *x);
t_jit_err            cv_jit_LKflow_gpu_matrix_calc(t_cv_jit_LKflow_gpu *x, void *inputs, void *outputs);
void                 cv_jit_LKflow_gpu_reset(t_cv_jit_LKflow_gpu *x);

t_jit_err cv_jit_LKflow_gpu_set_winsize(t_cv_jit_LKflow_gpu *x, void *attr, long ac, t_atom *av);
t_jit_err cv_jit_LKflow_gpu_set_maxlevel(t_cv_jit_LKflow_gpu *x, void *attr, long ac, t_atom *av);
t_jit_err cv_jit_LKflow_gpu_set_iters(t_cv_jit_LKflow_gpu *x, void *attr, long ac, t_atom *av);
t_jit_err cv_jit_LKflow_gpu_set_use_initial(t_cv_jit_LKflow_gpu *x, void *attr, long ac, t_atom *av);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Rebuild the DensePyrLKOpticalFlow object after any parameter change.
static void rebuild_flow_object(t_cv_jit_LKflow_gpu *x)
{
    if (!x || !x->d_lkflow) return;

    // winsize must be odd and >= 3
    int ws = (int)x->winsize;
    if (ws < 3) ws = 3;
    if ((ws & 1) == 0) ws += 1;
    x->winsize = ws;

    *x->d_lkflow = cv::cuda::DensePyrLKOpticalFlow::create(
        cv::Size(ws, ws),
        (int)x->maxlevel,
        (int)x->iters,
        x->use_initial != 0
    );
}

// ---------------------------------------------------------------------------
// Attribute setters
// ---------------------------------------------------------------------------

t_jit_err cv_jit_LKflow_gpu_set_winsize(t_cv_jit_LKflow_gpu *x, void *attr, long ac, t_atom *av)
{
    if (ac < 1) return JIT_ERR_NONE;
    long v = atom_getlong(av);
    if (v < 3)  v = 3;
    if (v > 99) v = 99;
    if ((v & 1) == 0) v += 1;
    x->winsize = v;
    rebuild_flow_object(x);
    return JIT_ERR_NONE;
}

t_jit_err cv_jit_LKflow_gpu_set_maxlevel(t_cv_jit_LKflow_gpu *x, void *attr, long ac, t_atom *av)
{
    if (ac < 1) return JIT_ERR_NONE;
    long v = atom_getlong(av);
    if (v < 0) v = 0;
    if (v > 8) v = 8;
    x->maxlevel = v;
    rebuild_flow_object(x);
    return JIT_ERR_NONE;
}

t_jit_err cv_jit_LKflow_gpu_set_iters(t_cv_jit_LKflow_gpu *x, void *attr, long ac, t_atom *av)
{
    if (ac < 1) return JIT_ERR_NONE;
    long v = atom_getlong(av);
    if (v < 1)   v = 1;
    if (v > 100) v = 100;
    x->iters = v;
    rebuild_flow_object(x);
    return JIT_ERR_NONE;
}

t_jit_err cv_jit_LKflow_gpu_set_use_initial(t_cv_jit_LKflow_gpu *x, void *attr, long ac, t_atom *av)
{
    if (ac < 1) return JIT_ERR_NONE;
    x->use_initial = (atom_getlong(av) != 0) ? 1L : 0L;
    rebuild_flow_object(x);
    return JIT_ERR_NONE;
}

// ---------------------------------------------------------------------------
// Class initialization
// ---------------------------------------------------------------------------

t_jit_err cv_jit_LKflow_gpu_init(void)
{
    // Inform the user at load time if no CUDA GPU is present
    if (cv::cuda::getCudaEnabledDeviceCount() == 0) {
        object_post(nullptr,
            "cv.jit.LKflow.gpu: WARNING - no CUDA-capable GPU detected. "
            "The object will post an error when it receives a matrix.");
    }

    long attrflags = ATTR_GET_DEFER_LOW | ATTR_SET_USURP_LOW;
    t_jit_object *attr, *mop;

    _cv_jit_LKflow_gpu_class = jit_class_new(
        "cv_jit_LKflow_gpu",
        (method)cv_jit_LKflow_gpu_new,
        (method)cv_jit_LKflow_gpu_free,
        sizeof(t_cv_jit_LKflow_gpu),
        A_CANT, 0L
    );

    // Matrix operator: 1 input, 1 output (2-plane float32)
    mop = (t_jit_object *)jit_object_new(_jit_sym_jit_mop, 1, 1);
    jit_mop_single_type(mop, _jit_sym_float32);
    jit_mop_single_planecount(mop, 2);
    jit_class_addadornment(_cv_jit_LKflow_gpu_class, mop);

    // Methods
    jit_class_addmethod(_cv_jit_LKflow_gpu_class,
        (method)cv_jit_LKflow_gpu_matrix_calc, "matrix_calc", A_CANT, 0L);
    jit_class_addmethod(_cv_jit_LKflow_gpu_class,
        (method)cv_jit_LKflow_gpu_reset, "reset", A_NOTHING, 0L);

    // Attributes

    // winsize: odd integer in [3, 99]
    attr = (t_jit_object *)jit_object_new(_jit_sym_jit_attr_offset,
        "winsize", _jit_sym_long, attrflags,
        (method)0L, (method)cv_jit_LKflow_gpu_set_winsize,
        calcoffset(t_cv_jit_LKflow_gpu, winsize));
    jit_attr_addfilterset_clip(attr, 3, 99, true, true);
    jit_class_addattr(_cv_jit_LKflow_gpu_class, attr);

    // maxlevel: integer in [0, 8]
    attr = (t_jit_object *)jit_object_new(_jit_sym_jit_attr_offset,
        "maxlevel", _jit_sym_long, attrflags,
        (method)0L, (method)cv_jit_LKflow_gpu_set_maxlevel,
        calcoffset(t_cv_jit_LKflow_gpu, maxlevel));
    jit_attr_addfilterset_clip(attr, 0, 8, true, true);
    jit_class_addattr(_cv_jit_LKflow_gpu_class, attr);

    // iters: integer in [1, 100]
    attr = (t_jit_object *)jit_object_new(_jit_sym_jit_attr_offset,
        "iters", _jit_sym_long, attrflags,
        (method)0L, (method)cv_jit_LKflow_gpu_set_iters,
        calcoffset(t_cv_jit_LKflow_gpu, iters));
    jit_attr_addfilterset_clip(attr, 1, 100, true, true);
    jit_class_addattr(_cv_jit_LKflow_gpu_class, attr);

    // use_initial: boolean 0/1
    attr = (t_jit_object *)jit_object_new(_jit_sym_jit_attr_offset,
        "use_initial", _jit_sym_long, attrflags,
        (method)0L, (method)cv_jit_LKflow_gpu_set_use_initial,
        calcoffset(t_cv_jit_LKflow_gpu, use_initial));
    jit_attr_addfilterset_clip(attr, 0, 1, true, true);
    jit_class_addattr(_cv_jit_LKflow_gpu_class, attr);

    jit_class_register(_cv_jit_LKflow_gpu_class);
    return JIT_ERR_NONE;
}

// ---------------------------------------------------------------------------
// matrix_calc
// ---------------------------------------------------------------------------

t_jit_err cv_jit_LKflow_gpu_matrix_calc(t_cv_jit_LKflow_gpu *x, void *inputs, void *outputs)
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
            "cv.jit.LKflow.gpu: input must be 1-plane char (8-bit grayscale)");
        err = JIT_ERR_MISMATCH_TYPE;
        goto out;
    }
    if (in_minfo.dimcount != 2) {
        object_error((t_object *)x,
            "cv.jit.LKflow.gpu: input must be a 2D matrix");
        err = JIT_ERR_MISMATCH_DIM;
        goto out;
    }

    // Runtime CUDA check
    if (cv::cuda::getCudaEnabledDeviceCount() == 0) {
        object_error((t_object *)x,
            "cv.jit.LKflow.gpu: no CUDA-capable GPU available");
        err = JIT_ERR_GENERIC;
        goto out;
    }

    {
        int cols = (int)in_minfo.dim[0];
        int rows = (int)in_minfo.dim[1];

        // Wrap the Jitter input buffer as a cv::Mat (zero-copy).
        // dimstride[1] is the byte stride between rows (may include padding).
        cv::Mat h_current(rows, cols, CV_8UC1, in_bp,
                          static_cast<size_t>(in_minfo.dimstride[1]));

        try {
            // Upload current frame to GPU
            cv::cuda::GpuMat d_current;
            d_current.upload(h_current);

            // If no previous frame stored (first call or after reset/resize),
            // store the current frame and output zeros.
            bool size_changed = (!x->d_prev->empty() &&
                                 (x->d_prev->cols != cols || x->d_prev->rows != rows));

            if (x->d_prev->empty() || size_changed) {
                d_current.copyTo(*x->d_prev);

                // Resize and zero the output matrix
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
            // Compute dense LK optical flow on the GPU
            // Output d_flow is CV_32FC2: per-pixel (dx, dy)
            // ----------------------------------------------------------------
            cv::cuda::GpuMat d_flow;
            (*x->d_lkflow)->calc(*x->d_prev, d_current, d_flow);

            // Download result to host
            cv::Mat h_flow;
            d_flow.download(h_flow);  // CV_32FC2

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
            d_current.copyTo(*x->d_prev);

        } catch (const cv::Exception &e) {
            object_error((t_object *)x,
                "cv.jit.LKflow.gpu: OpenCV error: %s", e.what());
            err = JIT_ERR_GENERIC;
        }
    }

out:
    jit_object_method(out_matrix, gensym("lock"), out_savelock);
    jit_object_method(in_matrix,  gensym("lock"), in_savelock);
    return err;
}

// ---------------------------------------------------------------------------
// reset message — clears the stored previous frame
// ---------------------------------------------------------------------------

void cv_jit_LKflow_gpu_reset(t_cv_jit_LKflow_gpu *x)
{
    if (x && x->d_prev) {
        x->d_prev->release();
    }
}

// ---------------------------------------------------------------------------
// Constructor / Destructor
// ---------------------------------------------------------------------------

t_cv_jit_LKflow_gpu *cv_jit_LKflow_gpu_new(void)
{
    t_cv_jit_LKflow_gpu *x =
        (t_cv_jit_LKflow_gpu *)jit_object_alloc(_cv_jit_LKflow_gpu_class);

    if (x) {
        x->winsize      = 13;   // GPU DensePyrLK default
        x->maxlevel     = 3;
        x->iters        = 30;
        x->use_initial  = 0;

        x->d_prev   = new cv::cuda::GpuMat();
        x->d_lkflow = new cv::Ptr<cv::cuda::DensePyrLKOpticalFlow>();

        rebuild_flow_object(x);
    }

    return x;
}

void cv_jit_LKflow_gpu_free(t_cv_jit_LKflow_gpu *x)
{
    delete x->d_prev;
    delete x->d_lkflow;
}

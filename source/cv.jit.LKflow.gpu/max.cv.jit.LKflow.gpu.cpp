/*
max.cv.jit.LKflow.gpu

Max/MSP wrapper for the cv_jit_LKflow_gpu Jitter object.
Exposes the object to Max as "cv.jit.LKflow.gpu".

Based on max.cv.jit.LKflow by Jean-Marc Pelletier (jmp@jmpelletier.com).
Licensed under the GNU Lesser General Public License v3 or later.
See <http://www.gnu.org/licenses/>.
*/

#include "c74_jitter.h"

using namespace c74::max;

typedef struct _max_cv_jit_LKflow_gpu
{
    t_object    ob;
    void        *obex;
} t_max_cv_jit_LKflow_gpu;

t_jit_err cv_jit_LKflow_gpu_init(void);

void  *max_cv_jit_LKflow_gpu_new(t_symbol *s, long argc, t_atom *argv);
void   max_cv_jit_LKflow_gpu_free(t_max_cv_jit_LKflow_gpu *x);
void   max_cv_jit_LKflow_gpu_reset(t_max_cv_jit_LKflow_gpu *x);

void  *max_cv_jit_LKflow_gpu_class;

// ---------------------------------------------------------------------------
// ext_main — called when the external is loaded by Max
// ---------------------------------------------------------------------------

#ifdef __cplusplus
extern "C"
#endif
void ext_main(void *unused)
{
    void *p, *q;

    union { void **v_ptr; t_messlist **m_ptr; } alias_ptr;
    alias_ptr.v_ptr = &max_cv_jit_LKflow_gpu_class;

    cv_jit_LKflow_gpu_init();

    setup(alias_ptr.m_ptr,
          (method)max_cv_jit_LKflow_gpu_new,
          (method)max_cv_jit_LKflow_gpu_free,
          (short)sizeof(t_max_cv_jit_LKflow_gpu),
          0L, A_GIMME, 0);

    p = max_jit_classex_setup(calcoffset(t_max_cv_jit_LKflow_gpu, obex));
    q = jit_class_findbyname(gensym("cv_jit_LKflow_gpu"));

    max_jit_classex_mop_wrap(p, q, 0);
    max_jit_classex_standard_wrap(p, q, 0);

    // Expose the "reset" message to Max
    addmess((method)max_cv_jit_LKflow_gpu_reset, "reset", A_NOTHING, 0);
    addmess((method)max_jit_mop_assist, "assist", A_CANT, 0);
}

// ---------------------------------------------------------------------------
// reset — forwarded to the inner Jitter object
// ---------------------------------------------------------------------------

void max_cv_jit_LKflow_gpu_reset(t_max_cv_jit_LKflow_gpu *x)
{
    void *jit_ob = max_jit_obex_jitob_get(x);
    if (jit_ob) {
        jit_object_method(jit_ob, gensym("reset"));
    }
}

// ---------------------------------------------------------------------------
// Constructor / Destructor
// ---------------------------------------------------------------------------

void max_cv_jit_LKflow_gpu_free(t_max_cv_jit_LKflow_gpu *x)
{
    max_jit_mop_free(x);
    jit_object_free(max_jit_obex_jitob_get(x));
    max_jit_obex_free(x);
}

void *max_cv_jit_LKflow_gpu_new(t_symbol *s, long argc, t_atom *argv)
{
    t_max_cv_jit_LKflow_gpu *x;
    void *o;

    x = (t_max_cv_jit_LKflow_gpu *)max_jit_obex_new(
            max_cv_jit_LKflow_gpu_class, gensym("cv_jit_LKflow_gpu"));

    if (x) {
        o = jit_object_new(gensym("cv_jit_LKflow_gpu"));
        if (o) {
            max_jit_mop_setup_simple(x, o, argc, argv);
            max_jit_attr_args(x, (short)argc, argv);
        } else {
            object_error((t_object *)x,
                "cv.jit.LKflow.gpu: could not allocate Jitter object");
            object_free((t_object *)x);
            x = nullptr;
        }
    }

    return x;
}

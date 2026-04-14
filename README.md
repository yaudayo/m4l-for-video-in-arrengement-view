# m4l-for-video-in-arrengement-view

GPU-accelerated Max/MSP Jitter externals for video processing in Live's
Arrangement View.

---

## cv.jit.LKflow.gpu

Dense Lucas-Kanade optical flow computed on the GPU using OpenCV's CUDA
module (`cv::cuda::DensePyrLKOpticalFlow`).  
It is a drop-in replacement for `cv.jit.LKflow` (from the
[cv.jit](https://github.com/Cycling74/cv.jit) library) with significantly
higher frame rates on CUDA-capable hardware.

### Inlet / Outlet

| | Type | Description |
|---|---|---|
| **Inlet** | 1-plane `char` | 8-bit grayscale Jitter matrix |
| **Outlet** | 2-plane `float32` | Optical flow field — plane 0 = horizontal (x), plane 1 = vertical (y) |

### Attributes

| Attribute | Type | Default | Description |
|---|---|---|---|
| `@winsize` | int (odd, 3-99) | 13 | Lucas-Kanade search window size |
| `@maxlevel` | int (0-8) | 3 | Pyramid depth |
| `@iters` | int (1-100) | 30 | Solver iterations per level |
| `@use_initial` | int (0/1) | 0 | Warm-start flow from previous frame |

### Messages

| Message | Description |
|---|---|
| `reset` | Clears the stored previous frame (useful when switching video sources) |

### Comparison with cv.jit.LKflow

| | cv.jit.LKflow | cv.jit.LKflow.gpu |
|---|---|---|
| OpenCV API | Legacy C API (`cvCalcOpticalFlowLK`) | CUDA C++ API (`DensePyrLKOpticalFlow`) |
| Hardware | CPU only | CUDA GPU |
| Window attr | `@radius` (half-size) | `@winsize` (full size, odd) |
| Extra attrs | — | `@maxlevel`, `@iters`, `@use_initial`, `reset` msg |

---

## cv.jit.LKflow.lite

CPU-based dense optical flow using `cv::calcOpticalFlowFarneback`.  
Works on **any hardware** — no CUDA GPU required.  
On machines with Intel or AMD integrated GPUs, OpenCV's Transparent API
(`cv::UMat`) automatically dispatches the computation to the GPU via
**OpenCL**, giving a meaningful speed-up over a pure CPU path.

This is a drop-in replacement for `cv.jit.LKflow.gpu` when a CUDA GPU is
not available.

### Inlet / Outlet

Same as `cv.jit.LKflow.gpu`.

| | Type | Description |
|---|---|---|
| **Inlet** | 1-plane `char` | 8-bit grayscale Jitter matrix |
| **Outlet** | 2-plane `float32` | Optical flow field — plane 0 = horizontal (x), plane 1 = vertical (y) |

### Attributes

| Attribute | Type | Default | Description |
|---|---|---|---|
| `@winsize` | int (odd, 3-99) | 13 | Farneback averaging window size |
| `@maxlevel` | int (0-8) | 3 | Pyramid depth |
| `@iters` | int (1-100) | 10 | Iterations per pyramid level |
| `@use_initial` | int (0/1) | 0 | Warm-start flow from previous frame |

### Messages

| Message | Description |
|---|---|
| `reset` | Clears the stored previous frame and flow field |

### Comparison

| | cv.jit.LKflow.gpu | cv.jit.LKflow.lite |
|---|---|---|
| Algorithm | Dense Pyr LK (CUDA) | Farneback (CPU / OpenCL) |
| Hardware | CUDA GPU (NVIDIA only) | Any CPU; Intel/AMD iGPU via OpenCL |
| CUDA required | Yes | **No** |
| Build deps | OpenCV with CUDA modules | Standard OpenCV 4 |
| Max/MSP object name | `cv.jit.LKflow.gpu` | `cv.jit.LKflow.lite` |

### Hardware acceleration (Intel iGPU)

At load time the object posts which OpenCL device is active:

```
cv.jit.LKflow.lite: OpenCL available (Intel(R) UHD Graphics 770). Hardware acceleration enabled.
```

If no OpenCL runtime is installed it falls back silently to the CPU:

```
cv.jit.LKflow.lite: OpenCL not available. Running on CPU.
```

To enable OpenCL on Windows with an Intel iGPU, install the
[Intel Graphics Driver](https://www.intel.com/content/www/us/en/download-center/home.html)
(includes the OpenCL runtime).  On Linux, install `intel-opencl-icd` (part of
the Intel Compute Runtime package).

---

## Build instructions

### Prerequisites

#### cv.jit.LKflow.gpu (CUDA GPU required)

1. **cv.jit** source tree (provides shared cmake scripts, headers, Max SDK)  
   `git clone --recurse-submodules https://github.com/Cycling74/cv.jit`

2. **OpenCV 4** built **with CUDA support**  
   Configure OpenCV with `-DWITH_CUDA=ON` and build the
   `opencv_cudaoptflow` and `opencv_cudaarithm` modules.

3. **CUDA Toolkit** (≥ 10.0 recommended)

#### cv.jit.LKflow.lite (no CUDA required — works on Intel/AMD iGPU)

1. **cv.jit** source tree (same as above)

2. **OpenCV 4** — standard prebuilt binaries are fine (no CUDA needed)  
   e.g. `brew install opencv` on macOS, `apt install libopencv-dev` on Ubuntu,
   or download the official Windows installer from opencv.org.

3. *(Optional)* **OpenCL runtime** for Intel/AMD iGPU acceleration  
   Windows: install the Intel Graphics Driver.  
   Linux: install `intel-opencl-icd` (Intel Compute Runtime).

### Option A — drop into cv.jit project tree (recommended)

```bash
# Copy the externals into cv.jit's projects directory
cp -r source/cv.jit.LKflow.gpu  /path/to/cv.jit/source/projects/
cp -r source/cv.jit.LKflow.lite /path/to/cv.jit/source/projects/

# Add them to cv.jit's top-level CMakeLists.txt:
#   add_subdirectory(source/projects/cv.jit.LKflow.gpu)
#   add_subdirectory(source/projects/cv.jit.LKflow.lite)

cd /path/to/cv.jit
mkdir build && cd build
cmake .. -DOPENCV4_INSTALL_DIR=/usr/local/opencv4
cmake --build . --target cv.jit.LKflow.gpu    # CUDA version
cmake --build . --target cv.jit.LKflow.lite   # lite version (no CUDA)
```

### Option B — standalone build

```bash
mkdir build && cd build
cmake .. \
  -DCVJIT_SOURCE_DIR=/path/to/cv.jit/source \
  -DOPENCV4_INSTALL_DIR=/usr/local/opencv4
cmake --build .   # builds both gpu and lite targets
```

The compiled externals are placed in the cv.jit `externals` directory.  
Copy them to your Max search path (e.g. `~/Documents/Max 8/Packages/`).

---

## Usage in Max/MSP

Use `cv.jit.LKflow.gpu` when an NVIDIA CUDA GPU is available, or swap in
`cv.jit.LKflow.lite` for Intel/AMD iGPU and CPU-only machines.  The inlets,
outlets, and attributes are identical.

```
[jit.movie]
    |
[jit.rgb2luma]                            <- convert to grayscale char
    |
[cv.jit.LKflow.gpu @winsize 13 @maxlevel 3]   <- NVIDIA CUDA GPU
 -- or --
[cv.jit.LKflow.lite @winsize 13 @maxlevel 3]  <- Intel/AMD iGPU / CPU
    |
[jit.unpack 2]                            <- split x/y planes
   | |
  [x][y]
```

The output planes can be fed into `jit.cellblock`, visualised with
`jit.pwindow`, or used to drive other Jitter effects.

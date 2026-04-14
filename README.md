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
| `@winsize` | int (odd, 3–99) | 13 | Lucas-Kanade search window size |
| `@maxlevel` | int (0–8) | 3 | Pyramid depth |
| `@iters` | int (1–100) | 30 | Solver iterations per level |
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

## Build instructions

### Prerequisites

1. **cv.jit** source tree (provides shared cmake scripts, headers, Max SDK)  
   `git clone --recurse-submodules https://github.com/Cycling74/cv.jit`

2. **OpenCV 4** built **with CUDA support**  
   Configure OpenCV with `-DWITH_CUDA=ON` and build the
   `opencv_cudaoptflow` and `opencv_cudaarithm` modules.

3. **CUDA Toolkit** (≥ 10.0 recommended)

### Option A — drop into cv.jit project tree (recommended)

```bash
# Copy this folder into cv.jit's projects directory
cp -r source/cv.jit.LKflow.gpu /path/to/cv.jit/source/projects/

# Add it to cv.jit's top-level CMakeLists.txt:
#   add_subdirectory(source/projects/cv.jit.LKflow.gpu)

cd /path/to/cv.jit
mkdir build && cd build
cmake .. -DOPENCV4_INSTALL_DIR=/usr/local/opencv4
cmake --build . --target cv.jit.LKflow.gpu
```

### Option B — standalone build

```bash
mkdir build && cd build
cmake .. \
  -DCVJIT_SOURCE_DIR=/path/to/cv.jit/source \
  -DOPENCV4_INSTALL_DIR=/usr/local/opencv4
cmake --build .
```

The compiled external is placed in the cv.jit `externals` directory.  
Copy it to your Max search path (e.g. `~/Documents/Max 8/Packages/`).

---

## Usage in Max/MSP

```
[jit.movie]
    |
[jit.rgb2luma]          <- convert to grayscale char
    |
[cv.jit.LKflow.gpu @winsize 13 @maxlevel 3]
    |
[jit.unpack 2]          <- split x/y planes
   | |
  [x][y]
```

The output planes can be fed into `jit.cellblock`, visualised with
`jit.pwindow`, or used to drive other Jitter effects.

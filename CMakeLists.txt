# cv.jit.LKflow.gpu — root CMakeLists.txt
#
# Standalone build entry point.
#
# This file lets you build cv.jit.LKflow.gpu without cloning the entire
# cv.jit repository, provided you already have:
#   1. A cv.jit source tree (for the shared cmake scripts and headers)
#   2. The Max SDK (max-sdk-base, usually a git submodule inside cv.jit)
#   3. OpenCV 4 with CUDA modules
#   4. CUDA Toolkit
#
# Usage
# -----
#   mkdir build && cd build
#   cmake .. \
#     -DCVJIT_SOURCE_DIR=/path/to/cv.jit/source \
#     -DOPENCV4_INSTALL_DIR=/usr/local/opencv4
#   cmake --build .
#
# The compiled external (.mxo on macOS, .mxe64 on Windows) is placed in
# the cv.jit externals directory by default, or in build/externals if you
# set CMAKE_LIBRARY_OUTPUT_DIRECTORY manually.

cmake_minimum_required(VERSION 3.15)
project(cv.jit.LKflow.gpu)

# ---------------------------------------------------------------------------
# Path to the cv.jit source tree (contains shared cmake helpers + headers)
# ---------------------------------------------------------------------------
if (NOT DEFINED CVJIT_SOURCE_DIR)
    message(FATAL_ERROR
        "Please set CVJIT_SOURCE_DIR to the 'source' directory of a cv.jit "
        "checkout, e.g.: cmake .. -DCVJIT_SOURCE_DIR=/path/to/cv.jit/source")
endif()

# ---------------------------------------------------------------------------
# Delegate to the per-target CMakeLists.txt in source/cv.jit.LKflow.gpu/
# It uses the cv.jit pretarget/posttarget helpers, so we must set up the
# cmake module path the same way the cv.jit super-project does.
# ---------------------------------------------------------------------------
list(APPEND CMAKE_MODULE_PATH "${CVJIT_SOURCE_DIR}/projects")

add_subdirectory(
    ${CMAKE_CURRENT_SOURCE_DIR}/source/cv.jit.LKflow.gpu
    ${CMAKE_CURRENT_BINARY_DIR}/cv.jit.LKflow.gpu
)

add_subdirectory(
    ${CMAKE_CURRENT_SOURCE_DIR}/source/cv.jit.LKflow.lite
    ${CMAKE_CURRENT_BINARY_DIR}/cv.jit.LKflow.lite
)

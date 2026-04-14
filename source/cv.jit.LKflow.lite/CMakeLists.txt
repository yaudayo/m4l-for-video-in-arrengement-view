# cv.jit.LKflow.lite — CMakeLists.txt
#
# CPU-based dense optical flow with optional OpenCL acceleration via OpenCV's
# Transparent API (cv::UMat).  No CUDA or NVIDIA GPU required.
#
# This file is designed to be placed inside the cv.jit project tree at:
#   <cv.jit>/source/projects/cv.jit.LKflow.lite/
#
# Prerequisites
#   • OpenCV 4 (standard build; CUDA is NOT required)
#   • cmake variable OPENCV4_INSTALL_DIR pointing to your OpenCV 4 install
#
# Building inside cv.jit
#   cd <cv.jit root>
#   mkdir build && cd build
#   cmake .. -DOPENCV4_INSTALL_DIR=/usr/local/opencv4
#   cmake --build . --target cv.jit.LKflow.lite

# ---- boilerplate shared with every cv.jit external -------------------------

include(${CMAKE_CURRENT_SOURCE_DIR}/../cvjit-pretarget.cmake)

unset(PROJECT_SOURCES)
if (EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/max.${PROJECT_NAME}.cpp)
    set(PROJECT_SOURCES ${PROJECT_SOURCES} max.${PROJECT_NAME}.cpp)
endif()
if (EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/${PROJECT_NAME}.cpp)
    set(PROJECT_SOURCES ${PROJECT_SOURCES} ${PROJECT_NAME}.cpp)
endif()

add_library(
    ${PROJECT_NAME}
    MODULE
    ${PROJECT_SOURCES}
)

# ---- OpenCV (standard; no CUDA modules needed) -----------------------------

# Find OpenCV headers and libraries.
# Prefer a package-config or cmake config in OPENCV4_INSTALL_DIR if provided,
# otherwise fall back to the system-installed find_package(OpenCV).
if (DEFINED OPENCV4_INSTALL_DIR)
    set(OpenCV_DIR "${OPENCV4_INSTALL_DIR}")
endif()

find_package(OpenCV 4 REQUIRED COMPONENTS core imgproc video)

target_include_directories(${PROJECT_NAME} PRIVATE ${OpenCV_INCLUDE_DIRS})
target_link_libraries(${PROJECT_NAME} PUBLIC ${OpenCV_LIBS})

# ---- standard cv.jit post-target -------------------------------------------

include(${CMAKE_CURRENT_SOURCE_DIR}/../cvjit-posttarget.cmake)

# cv.jit.LKflow.gpu — CMakeLists.txt
#
# This file is designed to be placed inside the cv.jit project tree at:
#   <cv.jit>/source/projects/cv.jit.LKflow.gpu/
#
# It follows the same structure as every other cv.jit external so that it
# integrates transparently with the cv.jit CMake super-project.
#
# Prerequisites
#   • OpenCV 4 built with CUDA support (opencv_cudaoptflow, opencv_cudaarithm)
#   • CUDA Toolkit installed and on PATH
#   • cmake variable OPENCV4_INSTALL_DIR pointing to your OpenCV 4 install
#
# Building inside cv.jit
#   cd <cv.jit root>
#   mkdir build && cd build
#   cmake .. -DOPENCV4_INSTALL_DIR=/usr/local/opencv4
#   cmake --build . --target cv.jit.LKflow.gpu

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

# ---- CUDA ------------------------------------------------------------------

find_package(CUDA REQUIRED)

target_include_directories(${PROJECT_NAME} PRIVATE ${CUDA_INCLUDE_DIRS})

# Link against OpenCV CUDA libraries.
# We need at least: opencv_core, opencv_imgproc, opencv_video,
#                   opencv_cudaoptflow, opencv_cudaarithm
if (WIN32)
    file(GLOB_RECURSE OPENCV_CUDA_LIBS
        "${OPENCV4_INSTALL_DIR}/x64/*cudaoptflow*.lib"
        "${OPENCV4_INSTALL_DIR}/x64/*cudaarithm*.lib"
        "${OPENCV4_INSTALL_DIR}/x64/*cudafilters*.lib"
    )
elseif (APPLE)
    file(GLOB OPENCV_CUDA_LIBS
        "${OPENCV4_INSTALL_DIR}/lib/libopencv_cudaoptflow*.a"
        "${OPENCV4_INSTALL_DIR}/lib/libopencv_cudaarithm*.a"
        "${OPENCV4_INSTALL_DIR}/lib/libopencv_cudafilters*.a"
        "${OPENCV4_INSTALL_DIR}/lib/libopencv_cudaimgproc*.a"
        "${OPENCV4_INSTALL_DIR}/lib/libopencv_cudawarping*.a"
    )
endif()

target_link_libraries(${PROJECT_NAME} PUBLIC
    ${OPENCV_CUDA_LIBS}
    ${CUDA_LIBRARIES}
    ${CUDA_nppi_LIBRARY}
)

# ---- standard cv.jit post-target -------------------------------------------

include(${CMAKE_CURRENT_SOURCE_DIR}/../cvjit-posttarget.cmake)

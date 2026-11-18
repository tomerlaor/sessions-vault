cmake_minimum_required(VERSION 3.22)
project(CleanBoost VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE is fetched automatically. To use a local checkout instead, configure with
#   -DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE
include(FetchContent)
FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.4
    GIT_SHALLOW ON)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(CleanBoost
    COMPANY_NAME "DIY Pedals"
    PRODUCT_NAME "Clean Boost"
    BUNDLE_ID com.diypedals.cleanboost
    PLUGIN_MANUFACTURER_CODE Diyp
    PLUGIN_CODE Clbt
    FORMATS VST3 AU Standalone
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
    VST3_CATEGORIES Fx Distortion
    AU_MAIN_TYPE kAudioUnitType_Effect)

target_sources(CleanBoost PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp)

target_compile_definitions(CleanBoost PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(CleanBoost
    PRIVATE
        juce::juce_audio_utils
        juce::juce_dsp
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

# Circuit model tests (no JUCE needed): ctest, or run circuit_test directly.
enable_testing()
add_executable(circuit_test tests/circuit_test.cpp)
target_include_directories(circuit_test PRIVATE Source)
add_test(NAME circuit_test COMMAND circuit_test)

# Full processor test: compiles the processor into a console app.
juce_add_console_app(processor_test)
target_sources(processor_test PRIVATE
    tests/processor_test.cpp
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp)
target_compile_definitions(processor_test PRIVATE
    JucePlugin_Name="Clean Boost"
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0)
target_link_libraries(processor_test PRIVATE
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_recommended_config_flags)
add_test(NAME processor_test COMMAND processor_test)

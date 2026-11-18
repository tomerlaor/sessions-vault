#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
#include "BoostCircuit.h"

class CleanBoostProcessor : public juce::AudioProcessor
{
public:
    CleanBoostProcessor();

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // Output level for the editor's LED, 0..1.
    float getOutputLevel() const { return outputLevel.load(); }

    juce::AudioProcessorValueTreeState params;

    // Audio-taper (log) pot: about 10% of the rotation's output at the midpoint.
    static float volumeTaper (float knob);

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();

    static constexpr int oversamplingFactorLog2 = 2;   // 4x

    std::unique_ptr<juce::dsp::Oversampling<float>> oversampling;
    std::vector<BoostCircuit> circuits;
    juce::SmoothedValue<float> volumeSmoothed, inputGainSmoothed;
    std::atomic<float> outputLevel { 0.0f };

    std::atomic<float>* volumeParam = nullptr;
    std::atomic<float>* inputParam = nullptr;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CleanBoostProcessor)
};

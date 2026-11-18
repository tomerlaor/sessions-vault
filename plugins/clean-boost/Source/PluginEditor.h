#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

class PedalLookAndFeel : public juce::LookAndFeel_V4
{
public:
    void drawRotarySlider (juce::Graphics&, int x, int y, int w, int h, float pos,
                           float startAngle, float endAngle, juce::Slider&) override;
};

class CleanBoostEditor : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit CleanBoostEditor (CleanBoostProcessor&);
    ~CleanBoostEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;

    CleanBoostProcessor& processor;
    PedalLookAndFeel lnf;

    juce::Slider volume, input;
    juce::Label volumeLabel, inputLabel;
    juce::AudioProcessorValueTreeState::SliderAttachment volumeAttach, inputAttach;

    float ledLevel = 0.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CleanBoostEditor)
};

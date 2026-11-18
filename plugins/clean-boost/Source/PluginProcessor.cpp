#include "PluginProcessor.h"
#include "PluginEditor.h"

CleanBoostProcessor::CleanBoostProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      params (*this, nullptr, "STATE", createLayout())
{
    volumeParam = params.getRawParameterValue ("volume");
    inputParam = params.getRawParameterValue ("input");
}

juce::AudioProcessorValueTreeState::ParameterLayout CleanBoostProcessor::createLayout()
{
    using namespace juce;
    AudioProcessorValueTreeState::ParameterLayout layout;

    // The pedal's single knob: VR1, the 100k output volume pot.
    layout.add (std::make_unique<AudioParameterFloat> (
        ParameterID { "volume", 1 }, "Volume",
        NormalisableRange<float> (0.0f, 1.0f), 0.5f,
        AudioParameterFloatAttributes().withStringFromValueFunction ([] (float v, int)
        {
            return String (v * 10.0f, 1);
        })));

    // Not on the pedal. Sets how hot the signal hitting the circuit is:
    // 0 dB means a full-scale sample is 1 V peak, which is a hot pickup.
    // Turn it up to push the transistor into clipping.
    layout.add (std::make_unique<AudioParameterFloat> (
        ParameterID { "input", 1 }, "Input Level",
        NormalisableRange<float> (-24.0f, 24.0f, 0.1f), 0.0f,
        AudioParameterFloatAttributes().withLabel ("dB")));

    return layout;
}

float CleanBoostProcessor::volumeTaper (float knob)
{
    // Exponential approximation of an "A" taper pot.
    constexpr float range = 100.0f;
    return (std::pow (range, knob) - 1.0f) / (range - 1.0f);
}

bool CleanBoostProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::mono() && out != juce::AudioChannelSet::stereo())
        return false;
    return layouts.getMainInputChannelSet() == out;
}

void CleanBoostProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    const auto channels = (size_t) juce::jmax (1, getTotalNumOutputChannels());

    oversampling = std::make_unique<juce::dsp::Oversampling<float>> (
        channels, oversamplingFactorLog2,
        juce::dsp::Oversampling<float>::filterHalfBandPolyphaseIIR, true, false);
    oversampling->initProcessing ((size_t) samplesPerBlock);
    setLatencySamples ((int) std::round (oversampling->getLatencyInSamples()));

    const double osRate = sampleRate * (1 << oversamplingFactorLog2);
    circuits.assign (channels, BoostCircuit());
    for (auto& c : circuits)
        c.prepare (osRate);

    volumeSmoothed.reset (sampleRate, 0.02);
    volumeSmoothed.setCurrentAndTargetValue (volumeTaper (volumeParam->load()));
    inputGainSmoothed.reset (osRate, 0.02);
    inputGainSmoothed.setCurrentAndTargetValue (juce::Decibels::decibelsToGain (inputParam->load()));
}

void CleanBoostProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numIn = getTotalNumInputChannels();
    const int numCh = juce::jmin (buffer.getNumChannels(), (int) circuits.size());
    for (int ch = numIn; ch < buffer.getNumChannels(); ++ch)
        buffer.clear (ch, 0, buffer.getNumSamples());

    volumeSmoothed.setTargetValue (volumeTaper (volumeParam->load()));
    inputGainSmoothed.setTargetValue (juce::Decibels::decibelsToGain (inputParam->load()));

    juce::dsp::AudioBlock<float> block (buffer);
    auto block2 = block.getSubsetChannelBlock (0, (size_t) numCh);
    auto os = oversampling->processSamplesUp (block2);

    // Circuit runs at the oversampled rate, with the pot fully up. The pot is
    // linear (after the nonlinearity), so it's applied at the base rate below.
    const auto osLen = os.getNumSamples();
    for (size_t i = 0; i < osLen; ++i)
    {
        const float g = inputGainSmoothed.getNextValue();
        for (int ch = 0; ch < numCh; ++ch)
        {
            auto* d = os.getChannelPointer ((size_t) ch);
            d[i] = (float) circuits[(size_t) ch].process ((double) (d[i] * g), 1.0);
        }
    }

    oversampling->processSamplesDown (block2);

    float peak = 0.0f;
    for (int i = 0; i < buffer.getNumSamples(); ++i)
    {
        const float v = volumeSmoothed.getNextValue();
        for (int ch = 0; ch < numCh; ++ch)
        {
            auto* d = buffer.getWritePointer (ch);
            d[i] *= v;
            peak = juce::jmax (peak, std::abs (d[i]));
        }
    }

    // Decaying peak meter for the LED.
    outputLevel.store (juce::jmax (peak, outputLevel.load() * 0.9f));
}

void CleanBoostProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    if (auto xml = params.copyState().createXml())
        copyXmlToBinary (*xml, destData);
}

void CleanBoostProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary (data, sizeInBytes))
        if (xml->hasTagName (params.state.getType()))
            params.replaceState (juce::ValueTree::fromXml (*xml));
}

juce::AudioProcessorEditor* CleanBoostProcessor::createEditor()
{
    return new CleanBoostEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new CleanBoostProcessor();
}

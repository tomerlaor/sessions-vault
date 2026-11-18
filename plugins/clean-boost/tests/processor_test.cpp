// Runs the full plugin processor (oversampling, parameters, pot taper) on sines.
#include "../Source/PluginProcessor.h"
#include <cstdio>

static int failures = 0;

static double run (CleanBoostProcessor& p, double fs, double freq, float amp, float volume, float inputDb)
{
    p.params.getParameter ("volume")->setValueNotifyingHost (volume);
    p.params.getParameter ("input")->setValueNotifyingHost (
        p.params.getParameterRange ("input").convertTo0to1 (inputDb));
    p.prepareToPlay (fs, 512);

    juce::AudioBuffer<float> buf (2, 512);
    juce::MidiBuffer midi;
    double phase = 0.0, peak = 0.0;
    for (int block = 0; block < 400; ++block)
    {
        for (int i = 0; i < 512; ++i)
        {
            const float x = amp * (float) std::sin (phase);
            phase += juce::MathConstants<double>::twoPi * freq / fs;
            buf.setSample (0, i, x);
            buf.setSample (1, i, x);
        }
        p.processBlock (buf, midi);
        if (block > 200)
            for (int i = 0; i < 512; ++i)
            {
                const float y = buf.getSample (0, i);
                if (! std::isfinite (y)) { ++failures; return -999.0; }
                peak = std::max (peak, (double) std::abs (y));
            }
    }
    return 20.0 * std::log10 (peak / amp);
}

static void check (const char* name, double v, double lo, double hi)
{
    const bool ok = v >= lo && v <= hi;
    if (! ok) ++failures;
    std::printf ("%-40s %8.2f dB [%g .. %g] %s\n", name, v, lo, hi, ok ? "ok" : "FAIL");
}

int main()
{
    juce::ScopedJuceInitialiser_GUI init;
    CleanBoostProcessor p;
    for (double fs : { 44100.0, 48000.0, 96000.0 })
    {
        std::printf ("-- %g Hz\n", fs);
        check ("volume 10, 1 kHz small signal", run (p, fs, 1000, 0.001f, 1.0f, 0.0f), 25.0, 27.5);
        check ("volume 5, 1 kHz small signal", run (p, fs, 1000, 0.001f, 0.5f, 0.0f), 4.0, 8.0);
        check ("volume 0 (silent)", std::max (-300.0, run (p, fs, 1000, 0.001f, 0.0f, 0.0f)), -300.0, -60.0);
        // 0.5 FS at +24 dB is ~8 V into the input. The output can't exceed the 9 V
        // rail, so the peak (in dB re 1 V) stays below 20*log10(9) = 19 dB.
        check ("clipping: peak out re 1 V, 8 V in", run (p, fs, 1000, 0.5f, 1.0f, 24.0f) + 20.0 * std::log10 (0.5), 9.0, 19.0);
    }
    std::printf ("latency: %d samples\n", p.getLatencySamples());
    std::printf ("%s\n", failures == 0 ? "All checks passed." : "Some checks FAILED.");
    return failures == 0 ? 0 : 1;
}

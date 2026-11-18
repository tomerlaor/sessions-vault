// Checks the circuit model against hand analysis of the schematic.
// Build: g++ -O2 -std=c++17 -I../Source circuit_test.cpp -o circuit_test

#include "BoostCircuit.h"
#include <cstdio>
#include <vector>

static const double pi = 3.14159265358979323846;
static int failures = 0;

static void check (const char* name, double value, double lo, double hi, const char* unit)
{
    const bool ok = value >= lo && value <= hi;
    if (! ok) ++failures;
    std::printf ("%-34s %10.3f %-4s [%g .. %g] %s\n", name, value, unit, lo, hi, ok ? "ok" : "FAIL");
}

// Runs a sine through the circuit and returns the settled output samples.
static std::vector<double> runSine (double fs, double freq, double amp, double volume, int periods = 40)
{
    BoostCircuit circuit;
    circuit.prepare (fs);
    const int n = (int) (fs / freq * periods);
    std::vector<double> out;
    for (int i = 0; i < n; ++i)
    {
        const double y = circuit.process (amp * std::sin (2.0 * pi * freq * i / fs), volume);
        if (i >= n / 2) out.push_back (y);   // skip the settling half
    }
    return out;
}

static double amplitudeAt (const std::vector<double>& x, double fs, double freq)
{
    double re = 0, im = 0;
    for (size_t i = 0; i < x.size(); ++i)
    {
        re += x[i] * std::cos (2.0 * pi * freq * i / fs);
        im += x[i] * std::sin (2.0 * pi * freq * i / fs);
    }
    return 2.0 * std::sqrt (re * re + im * im) / x.size();
}

static double gainDb (double fs, double freq, double amp = 0.001)
{
    const auto y = runSine (fs, freq, amp, 1.0, freq < 100 ? 60 : 40);
    return 20.0 * std::log10 (amplitudeAt (y, fs, freq) / amp);
}

int main()
{
    const double fs = 192000.0;   // the plugin runs the model at 4x oversampling

    BoostCircuit circuit;
    circuit.prepare (fs);
    std::printf ("DC operating point\n");
    check ("base voltage", circuit.getDcBaseVoltage(), 0.75, 0.85, "V");
    // Vc = 9 - Rc * (Vb - Vbe) / Re, with Vbe ~0.61 V and ~40 mV lost to base current in Rth.
    check ("collector voltage", circuit.getDcCollectorVoltage(), 3.5, 5.5, "V");

    // Small-signal gain at the collector, about Rc / (re + Re) = 10k / 436 = 27 dB.
    // The pot divider (100k / 110k) takes off 0.8 dB.
    std::printf ("\nSmall-signal response, volume at max\n");
    const double g1k = gainDb (fs, 1000.0);
    check ("gain at 1 kHz", g1k, 25.0, 27.5, "dB");
    check ("gain at 10 kHz rel. 1 kHz", gainDb (fs, 10000.0) - g1k, -0.5, 0.5, "dB");
    // Input corner: C1 against R1 || R2 || (beta * Re), about 50 Hz.
    check ("gain at 50 Hz rel. 1 kHz", gainDb (fs, 50.0) - g1k, -4.5, -1.5, "dB");
    check ("gain at 20 Hz rel. 1 kHz", gainDb (fs, 20.0) - g1k, -12.0, -5.0, "dB");

    // Large signal: the stage clips softly and asymmetrically (cutoff first).
    std::printf ("\nLarge signal at 1 kHz, volume at max\n");
    const double amps[] = { 0.01, 0.1, 0.3, 1.0 };
    for (double a : amps)
    {
        const auto y = runSine (fs, 1000.0, a, 1.0);
        double h1 = amplitudeAt (y, fs, 1000.0), h2 = amplitudeAt (y, fs, 2000.0), h3 = amplitudeAt (y, fs, 3000.0);
        double peakPos = 0, peakNeg = 0;
        for (double v : y) { peakPos = std::max (peakPos, v); peakNeg = std::min (peakNeg, v); }
        std::printf ("  in %5.2f V pk: out +%.2f / %.2f V, H2 %6.1f dB, H3 %6.1f dB\n",
                     a, peakPos, peakNeg, 20 * std::log10 (h2 / h1), 20 * std::log10 (h3 / h1));
        for (double v : y) if (! std::isfinite (v)) { ++failures; std::printf ("  non-finite output!\n"); break; }
    }
    // Output can't swing past the rails: about +5.6 V (cutoff) and -3.2 V (saturation).
    const auto hot = runSine (fs, 1000.0, 2.0, 1.0);
    double mx = 0, mn = 0;
    for (double v : hot) { mx = std::max (mx, v); mn = std::min (mn, v); }
    check ("max output swing, 2 V input", mx - mn, 6.0, 9.0, "Vpp");

    std::printf ("\n%s\n", failures == 0 ? "All checks passed." : "Some checks FAILED.");
    return failures == 0 ? 0 : 1;
}

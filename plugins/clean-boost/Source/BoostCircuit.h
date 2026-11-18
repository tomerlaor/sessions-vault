#pragma once

// Component-level model of a single-transistor (common-emitter) clean boost:
//
//   IN ──C1──┬──────────── B   Q1 (2N5088)        C ──R3── 9V
//            │                                    │
//      R1 to 9V, R2 to GND                        └──C2──┬ VR1 (volume) ── OUT
//                                    E ──R4── GND        GND
//
//   R1 430k, R2 43k, R3 10k, R4 390R, C1 100n, C2 100n, VR1 100k (audio taper)
//
// Modelled:
//   * Bias divider as a Thevenin source (Vth, Rth) feeding the base node.
//   * C1 as a trapezoidal companion model, solved together with the base node,
//     so the input high-pass corner moves with the stage input impedance.
//   * Q1 as an exponential (Ebers-Moll forward) junction with finite beta and
//     emitter degeneration through R4, solved per sample with Newton-Raphson.
//     This gives the circuit's natural soft, asymmetric cutoff clipping.
//   * Collector saturation as a smooth current limit when Vce -> Vce(sat).
//   * C2 into (R3 + VR1) as a first-order high-pass, then the volume divider.
//
// Signals are in volts. The caller decides how many volts full scale means.
// No JUCE dependency, so the model can be tested on its own.

#include <algorithm>
#include <cmath>

struct BoostComponents
{
    double vcc = 9.0;
    double r1 = 430e3, r2 = 43e3;   // bias divider
    double rc = 10e3, re = 390.0;   // collector / emitter
    double c1 = 100e-9, c2 = 100e-9;
    double rpot = 100e3;            // volume pot
    // 2N5088-ish transistor parameters
    double is = 20e-15;             // saturation current
    double beta = 400.0;            // forward current gain
    double vt = 0.025852;           // thermal voltage at ~27 C
    double vceSat = 0.1;
};

class BoostCircuit
{
public:
    using Components = BoostComponents;

    void prepare (double sampleRate, const Components& comps = Components())
    {
        c = comps;
        fs = sampleRate;

        vth = c.vcc * c.r2 / (c.r1 + c.r2);
        rth = c.r1 * c.r2 / (c.r1 + c.r2);
        gc1 = 2.0 * c.c1 * fs;            // trapezoidal conductance of C1
        betaRatio = 1.0 + 1.0 / c.beta;   // Ie / Ic

        // Output high-pass: C2 into R3 + VR1 (bilinear transform).
        const double rOut = c.rc + c.rpot;
        const double k = 2.0 * fs * rOut * c.c2;
        hpB0 = k / (k + 1.0);
        hpA1 = (1.0 - k) / (1.0 + k);
        potDivider = c.rpot / rOut;

        reset();
    }

    // Puts the circuit at its DC operating point, so there's no thump on start.
    void reset()
    {
        // DC: no current through C1, so (Vth - Vb) / Rth = Ib.
        double vbe = 0.6;
        for (int i = 0; i < 100; ++i)
        {
            const double e = std::exp (vbe / c.vt);
            const double ic = c.is * (e - 1.0);
            const double dic = c.is * e / c.vt;
            const double vb = vbe + c.re * betaRatio * ic;
            const double dvb = 1.0 + c.re * betaRatio * dic;
            const double f = (vth - vb) / rth - ic / c.beta;
            const double df = -dvb / rth - dic / c.beta;
            const double step = std::clamp (f / df, -0.05, 0.05);
            vbe -= step;
            if (std::abs (step) < 1e-12) break;
        }

        lastVbe = vbe;
        const double ic = collectorCurrent (vbe);
        dcVb = vbe + c.re * betaRatio * ic;
        dcVc = c.vcc - c.rc * limitSaturation (ic, c.re * betaRatio * ic);

        // C1 holds (vin - vb) = -Vb with no current through it.
        c1Ieq = gc1 * (0.0 - dcVb);

        hpX1 = dcVc;
        hpY1 = 0.0;
    }

    // One sample, input in volts. Returns the voltage at the pot's wiper.
    // `volume` is the wiper position 0..1 after the taper.
    double process (double vin, double volume)
    {
        // Solve the base node: (C1 current) + (bias current) = base current.
        double vbe = lastVbe;
        double ic = 0.0, vb = 0.0;
        for (int i = 0; i < maxIterations; ++i)
        {
            const double e = std::exp (vbe / c.vt);
            ic = c.is * (e - 1.0);
            const double dic = c.is * e / c.vt;
            vb = vbe + c.re * betaRatio * ic;
            const double dvb = 1.0 + c.re * betaRatio * dic;

            const double iC1 = gc1 * (vin - vb) - c1Ieq;
            const double f = iC1 + (vth - vb) / rth - ic / c.beta;
            const double df = -(gc1 + 1.0 / rth) * dvb - dic / c.beta;

            // Limit the step to keep the exponential well behaved.
            const double step = std::clamp (f / df, -4.0 * c.vt, 4.0 * c.vt);
            vbe -= step;
            if (std::abs (step) < 1e-9) break;
        }

        // Recompute with the final vbe and update the capacitor state.
        ic = collectorCurrent (vbe);
        vb = vbe + c.re * betaRatio * ic;
        const double vC1 = vin - vb;
        const double iC1 = gc1 * vC1 - c1Ieq;
        c1Ieq = gc1 * vC1 + iC1;
        lastVbe = vbe;

        const double ve = c.re * betaRatio * ic;
        const double vc = c.vcc - c.rc * limitSaturation (ic, ve);

        // C2 high-pass (blocks the collector's DC), then the volume divider.
        const double y = hpB0 * (vc - hpX1) - hpA1 * hpY1;
        hpX1 = vc;
        hpY1 = y;

        return y * potDivider * volume;
    }

    double getDcCollectorVoltage() const { return dcVc; }
    double getDcBaseVoltage() const { return dcVb; }

private:
    double collectorCurrent (double vbe) const
    {
        return c.is * (std::exp (vbe / c.vt) - 1.0);
    }

    // Collector current can't exceed what puts the collector at Ve + Vce(sat).
    // Smooth minimum, so saturation clipping is soft rather than a hard edge.
    double limitSaturation (double ic, double ve) const
    {
        const double icMax = std::max (0.0, (c.vcc - ve - c.vceSat) / c.rc);
        const double knee = 0.02 * icMax + 1e-9;
        const double d = ic - icMax;
        return 0.5 * (ic + icMax - std::sqrt (d * d + knee * knee));
    }

    static constexpr int maxIterations = 16;

    Components c;
    double fs = 48000.0;
    double vth = 0.0, rth = 0.0, gc1 = 0.0, betaRatio = 1.0;
    double hpB0 = 1.0, hpA1 = 0.0, potDivider = 1.0;

    double lastVbe = 0.6, c1Ieq = 0.0;
    double hpX1 = 0.0, hpY1 = 0.0;
    double dcVb = 0.0, dcVc = 0.0;
};

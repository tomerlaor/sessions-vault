#include "PluginEditor.h"

namespace
{
    const juce::Colour enclosure { 0xffc9a227 };   // mustard yellow
    const juce::Colour enclosureDark { 0xff8f7016 };
    const juce::Colour ink { 0xff1d1a14 };
    const juce::Colour knobColour { 0xff222222 };
}

void PedalLookAndFeel::drawRotarySlider (juce::Graphics& g, int x, int y, int w, int h, float pos,
                                         float startAngle, float endAngle, juce::Slider&)
{
    const auto bounds = juce::Rectangle<float> ((float) x, (float) y, (float) w, (float) h).reduced (4.0f);
    const float radius = juce::jmin (bounds.getWidth(), bounds.getHeight()) * 0.5f;
    const auto centre = bounds.getCentre();
    const float angle = startAngle + pos * (endAngle - startAngle);

    // Tick marks around the knob.
    g.setColour (ink.withAlpha (0.7f));
    for (int i = 0; i <= 10; ++i)
    {
        const float a = startAngle + (float) i / 10.0f * (endAngle - startAngle);
        const auto p1 = centre.getPointOnCircumference (radius * 0.98f, a);
        const auto p2 = centre.getPointOnCircumference (radius * 0.86f, a);
        g.drawLine ({ p1, p2 }, i % 5 == 0 ? 2.0f : 1.0f);
    }

    // Knob body with a soft shadow.
    const float kr = radius * 0.78f;
    g.setColour (juce::Colours::black.withAlpha (0.35f));
    g.fillEllipse (centre.x - kr + 2, centre.y - kr + 4, kr * 2, kr * 2);
    juce::ColourGradient grad (knobColour.brighter (0.5f), centre.x, centre.y - kr,
                               knobColour.darker (0.4f), centre.x, centre.y + kr, false);
    g.setGradientFill (grad);
    g.fillEllipse (centre.x - kr, centre.y - kr, kr * 2, kr * 2);
    g.setColour (juce::Colours::black);
    g.drawEllipse (centre.x - kr, centre.y - kr, kr * 2, kr * 2, 1.5f);

    // Pointer.
    g.setColour (juce::Colours::white);
    g.drawLine ({ centre.getPointOnCircumference (kr * 0.25f, angle),
                  centre.getPointOnCircumference (kr * 0.9f, angle) }, 3.0f);
}

CleanBoostEditor::CleanBoostEditor (CleanBoostProcessor& p)
    : AudioProcessorEditor (&p), processor (p),
      volumeAttach (p.params, "volume", volume),
      inputAttach (p.params, "input", input)
{
    for (auto* s : { &volume, &input })
    {
        s->setLookAndFeel (&lnf);
        s->setSliderStyle (juce::Slider::RotaryHorizontalVerticalDrag);
        s->setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
        s->setPopupDisplayEnabled (true, true, this);
        s->setRotaryParameters (juce::degreesToRadians (225.0f), juce::degreesToRadians (495.0f), true);
        addAndMakeVisible (*s);
    }
    volume.setDoubleClickReturnValue (true, 0.5);
    input.setDoubleClickReturnValue (true, 0.0);

    for (auto [label, text] : { std::pair { &volumeLabel, "VOLUME" }, std::pair { &inputLabel, "INPUT" } })
    {
        label->setText (text, juce::dontSendNotification);
        label->setJustificationType (juce::Justification::centred);
        label->setColour (juce::Label::textColourId, ink);
        addAndMakeVisible (*label);
    }
    volumeLabel.setFont (juce::FontOptions (16.0f, juce::Font::bold));
    inputLabel.setFont (juce::FontOptions (11.0f, juce::Font::bold));

    setSize (260, 420);
    startTimerHz (30);
}

CleanBoostEditor::~CleanBoostEditor()
{
    volume.setLookAndFeel (nullptr);
    input.setLookAndFeel (nullptr);
}

void CleanBoostEditor::timerCallback()
{
    const float target = juce::jlimit (0.0f, 1.0f, processor.getOutputLevel());
    if (std::abs (target - ledLevel) > 0.01f)
    {
        ledLevel = target;
        repaint (getLocalBounds().removeFromTop (60));
    }
}

void CleanBoostEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff2a2a2a));

    // Enclosure.
    const auto box = getLocalBounds().toFloat().reduced (10.0f);
    juce::ColourGradient grad (enclosure.brighter (0.15f), box.getX(), box.getY(),
                               enclosureDark, box.getRight(), box.getBottom(), false);
    g.setGradientFill (grad);
    g.fillRoundedRectangle (box, 14.0f);
    g.setColour (juce::Colours::black.withAlpha (0.5f));
    g.drawRoundedRectangle (box, 14.0f, 2.0f);

    // Status LED: glows brighter with output level.
    const auto led = juce::Rectangle<float> (0, 0, 14, 14).withCentre ({ box.getCentreX(), box.getY() + 28 });
    const auto lit = juce::Colour (0xffff2a1a).withAlpha (0.55f + 0.45f * ledLevel);
    g.setColour (lit.withAlpha (0.25f * ledLevel));
    g.fillEllipse (led.expanded (6.0f));
    g.setColour (lit);
    g.fillEllipse (led);
    g.setColour (juce::Colours::black);
    g.drawEllipse (led, 1.0f);

    // Title.
    g.setColour (ink);
    g.setFont (juce::FontOptions (30.0f, juce::Font::bold));
    g.drawText ("CLEAN", box.withY (box.getY() + 250).withHeight (34), juce::Justification::centred);
    g.setFont (juce::FontOptions (30.0f, juce::Font::bold));
    g.drawText ("BOOST", box.withY (box.getY() + 280).withHeight (34), juce::Justification::centred);

    // Footswitch.
    const auto fs = juce::Rectangle<float> (0, 0, 46, 46).withCentre ({ box.getCentreX(), box.getBottom() - 46 });
    g.setColour (juce::Colour (0xff9a9a9a));
    g.fillEllipse (fs);
    g.setColour (juce::Colour (0xffd8d8d8));
    g.fillEllipse (fs.reduced (8.0f));
    g.setColour (juce::Colours::black.withAlpha (0.6f));
    g.drawEllipse (fs, 1.5f);
}

void CleanBoostEditor::resized()
{
    const auto box = getLocalBounds().reduced (10);
    volume.setBounds (juce::Rectangle<int> (0, 0, 150, 150).withCentre ({ box.getCentreX(), box.getY() + 130 }));
    volumeLabel.setBounds (volume.getX(), volume.getBottom() - 4, volume.getWidth(), 24);
    input.setBounds (juce::Rectangle<int> (0, 0, 48, 48).withPosition (box.getRight() - 58, box.getY() + 14));
    inputLabel.setBounds (input.getX() - 8, input.getBottom() - 2, input.getWidth() + 16, 14);
}

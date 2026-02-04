# Video magnification

A local app for amplifying changes in video that are too small to notice, then playing back what was hidden: the color shift in a face as blood moves through it, or a beam swaying a fraction of a millimeter under load.

[![Color magnification on a face](figures/color-pulse.gif)](figures/color-pulse.gif)

*Same face video, left untouched, right after color magnification. The skin flushes and fades once per heartbeat.*

I started it after reading the MIT [Eulerian Video Magnification](https://people.csail.mit.edu/mrub/evm/) paper (Wu et al., SIGGRAPH 2012). The part that got me was that a plain webcam already records your pulse, and all that stands between the raw frames and seeing it is the right temporal filter. I wanted one place to try the different methods on my own clips instead of cloning five repos every time I had an idea.

## What it does

Five modes, each wrapping a published method:

- Color magnification with [Eulerian Video Magnification](https://github.com/brycedrennan/eulerian-magnification). Band-pass a chosen frequency range in time, scale it up, add it back. This is the one that surfaces a pulse or slow color change.
- Motion magnification with [STB-VMM](https://github.com/RLado/STB-VMM), a Swin-transformer model that amplifies small displacements rather than color.
- Heart rate from a face video using the [rPPG-Toolbox](https://github.com/ubicomplab/rPPG-Toolbox) algorithms (POS, CHROM, GREEN, ICA, LGI, PBV).
- Live vitals from a webcam using [pyVHR](https://github.com/phuselab/pyVHR) over a WebSocket, with heart rate and HRV updating while you sit in front of the camera.
- Audio recovery from visual vibration, following the [Visual Microphone](https://github.com/joeljose/Visual-Mic) approach: read sound back off the tiny vibrations an object shows on camera.

[![The app](figures/ui.png)](figures/ui.png)

*The app. Drop a clip or use the webcam, pick a mode, set the frequency band and amplification.*

## Motion

The same idea applied to displacement instead of color. Here the high string of a guitar is ringing, and its motion gets pushed well past what the eye catches in the raw footage.

[![Motion magnification on a guitar](figures/motion-guitar.gif)](figures/motion-guitar.gif)

*A guitar, raw on the left and motion-magnified on the right. Strings that look nearly still in the original blur out as they vibrate.*

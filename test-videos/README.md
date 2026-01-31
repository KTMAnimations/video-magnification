# Test Videos

Baseline test videos from the MIT CSAIL Eulerian Video Magnification project.

**Paper:** Wu, H.-Y., Rubinstein, M., Shih, E., Guttag, J., Durand, F., and Freeman, W. T. "Eulerian Video Magnification for Revealing Subtle Changes in the World." ACM Trans. Graph. (SIGGRAPH 2012).

**Source:** http://people.csail.mit.edu/mrub/vidmag/

## Directory Structure

```
mit-evm/
  source/       -- Original unprocessed input videos
  processed/    -- MIT's reference output (ground-truth magnification results)
```

## Videos and Parameters

### Color Magnification (Ideal Bandpass)

| Source | Processed | Freq Range (Hz) | Amplification | Pyramid Levels | Chrom Attenuation | Use Case |
|--------|-----------|-----------------|---------------|----------------|-------------------|----------|
| baby.mp4 (1.8M) | baby-iir-... (4.1M) | IIR r1=0.4, r2=0.05 | 10 | lambda_c=16 | 0.1 | Breathing motion |
| baby2.mp4 (4.9M) | baby2-ideal-... (6.3M) | 2.33 - 2.67 | 150 | 6 | 1.0 | Color change (pulse) |
| face.mp4 (1.6M) | face-ideal-... (2.6M) | 0.83 - 1.0 | 50 | 4 | 1.0 | Face color (pulse) |
| face2.mp4 (2.9M) | face2-ideal-... (3.2M) | 0.83 - 1.0 | 50 | 6 | 1.0 | Face color (pulse) |
| wrist.mp4 (1.9M) | wrist-iir-... (5.1M) | IIR r1=0.4, r2=0.05 | 10 | lambda_c=16 | 0.1 | Wrist pulse |

### Motion Magnification (Butterworth Bandpass)

| Source | Processed | Freq Range (Hz) | Amplification | Lambda_c | Chrom Attenuation | Use Case |
|--------|-----------|-----------------|---------------|----------|-------------------|----------|
| face2.mp4 (2.9M) | face2-butter-... (4.0M) | 0.5 - 10 | 20 | 80 | 0.0 | Head motion (pulse) |
| subway.mp4 (4.8M) | subway-butter-... (5.4M) | 3.6 - 6.2 | 60 | 45 | 0.3 | Structural vibration |
| shadow.mp4 (2.7M) | shadow-butter-... (3.1M) | 0.5 - 10 | 5 | 48 | 0.0 | Shadow motion |
| camera.mp4 (8.6M) | camera-butter-... (25M) | 45 - 100 | 150 | 20 | 0.0 | Camera vibration |
| guitar.mp4 (1.1M) | guitar-ideal-72-92-... (2.6M) | 72 - 92 | 75 | lambda_c=10 | 0.0 | Low E string |
| guitar.mp4 (1.1M) | guitar-ideal-100-120-... (3.1M) | 100 - 120 | 150 | lambda_c=10 | 0.0 | High E string |

## Recommended Test Scenarios

**Color magnification (EVM backend):**
- `face.mp4` with freq_min=0.83, freq_max=1.0, amplification=50 -- should reveal pulse
- `baby2.mp4` with freq_min=2.33, freq_max=2.67, amplification=150 -- should reveal breathing color

**Motion magnification (STB-VMM backend):**
- `baby.mp4` with magnification=10 -- should amplify breathing motion
- `guitar.mp4` with magnification=75 -- should show string vibrations
- `subway.mp4` with magnification=60 -- should reveal structural vibration

**Heart rate extraction (rPPG backend):**
- `face.mp4` or `face2.mp4` -- contain faces suitable for rPPG analysis

**Total size:** ~95 MB (source: 31 MB, processed: 64 MB)

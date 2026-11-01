"""Fixtures propias: PCM mono 16-bit, 22050 Hz, 4 s; sin contenido externo."""
from pathlib import Path
import math
import struct
import wave
root = Path(__file__).resolve().parent.parent / 'public' / 'fixtures'
root.mkdir(parents=True, exist_ok=True)
for name, frequency in zip('ABC', [261.63, 329.63, 392]):
    with wave.open(str(root / f'{name}.wav'), 'wb') as target:
        target.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        target.writeframes(b''.join(struct.pack('<h', int(4000 * min(1, t / 1100, (88200 - t) / 1100) * math.sin(2 * math.pi * frequency * t / 22050))) for t in range(88200)))

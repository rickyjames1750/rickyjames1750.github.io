# Third-party notices

Three.js and its examples/helpers are distributed under the MIT License. Copyright © 2010–2026 Three.js authors. The package's full license is at `node_modules/three/LICENSE`; upstream source: https://github.com/mrdoob/three.js.

Vite is a development/build dependency distributed under the MIT License: https://github.com/vitejs/vite.

Manrope and Instrument Serif are loaded optionally from Google Fonts, under their respective SIL Open Font Licenses: https://fonts.google.com/specimen/Manrope and https://fonts.google.com/specimen/Instrument+Serif. They are not bundled here.

All architectural, vehicle, foliage, and train meshes, music, and sound effects are original procedural work. Brand and landmark names identify regional design references; they do not imply sponsorship, affiliation, employment, membership, or university attendance.

## Rendering components and environment

The official Three.js `Sky`, `PMREMGenerator`, `GTAOPass`, `OutputPass`, and
`HDRLoader` components are reused under the Three.js MIT license. GTAO means
ground-truth ambient occlusion.

`public/environments/venice_sunset_1k.hdr`: **Venice Sunset**, Greg Zaal / Poly Haven,
https://polyhaven.com/a/venice_sunset . Distributed under CC0:
https://polyhaven.com/license and https://creativecommons.org/publicdomain/zero/1.0/ .
It is a reflection environment, not geographic imagery of San Francisco.

Full Three.js license follows:
The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Narration

The original portfolio narration script is included in `src/voice-guide.js`.
The bundled `public/narration/*.mp3` recordings use the af_heart voice from
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), whose weights are
released under the [Apache License 2.0](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/LICENSE).
Production used [Kokoro.js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js)
and the [ONNX distribution](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX).
Only finished audio is bundled; the production tools and model weights are not shipped to visitors.

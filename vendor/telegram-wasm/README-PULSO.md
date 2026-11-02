# Source accompanying the Telegram authentication worker

The files in this directory preserve the corresponding upstream WASM sources from mtcute commit `c43258260e8ceddb0ad37720b043f6891b837e27`. Original notices and source bytes are pinned in `SOURCE-MANIFEST.json`. The installed mtcute WASM 0.32.6 binaries are used unmodified; the scalar and SIMD binaries were previously matched to the upstream Git blobs. Rebuilding with WASI SDK 20 / LLVM 16 is repeatable locally but does **not** reproduce the npm binary bytes.

`PULSO-NOTICES.txt` preserves the previously reviewed original component notices, including the AES code derived from tgcrypto under LGPL-3.0, the applicable GPL/LGPL texts, libdeflate, SHA implementations, JavaScript wrappers and long's embedded WebAssembly. The top-level MIT package label alone does not describe all components.

The product serves `/telegram-sources.tar.gz` with these C sources, the installed JavaScript SDK modules, Pulso's integration sources, package lock and build scripts. No application identity, user session, account data or private configuration is included. npm package versions are pinned by the lockfile.

To replace the WASM: use Linux x64, WASI SDK 20.0 / LLVM 16 and GNU make. Run `npm ci` first. Create `packages/wasm/src`, then run `make all WASM_CC=/absolute/path/to/wasi-sdk-20.0/bin/clang` in `packages/wasm/lib`. This builds both targets. Copy their outputs into the installed `@mtcute/wasm` package and run `npm run build`. The emitted `.wasm` files remain separate same-origin assets, replaceable along with the JavaScript references by rebuilding. No signature or bit-identical reconstruction is claimed. Any changed SDK version/notices require a corresponding license-manifest review.

Pulso uses a separate bounded gunzip instance with the reviewed return-code/cleanup guard. It does not advertise gzip CRC validation or exact suffix consumption. The current authentication session is intentionally memory-only; the prior persistent-storage candidates are not included in this integration.

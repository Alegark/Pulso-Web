// Pulso-Web temporary Telegram auth integration, retaining the reviewed r16 guard.
// Bounds apply to this auth worker; not a general-purpose gzip/integrity guarantee.
export const EXPERIMENTAL_POLICY = Object.freeze({
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxExpansionRatio: 128,
  expansionSlackBytes: 65536,
  maxMemoryBytes: 16 * 1024 * 1024,
  allocatorReserveBytes: 256 * 1024,
});
export class CheckedGunzipError extends Error {
  constructor(code) { super(`checked gunzip: ${code}`); this.name = 'CheckedGunzipError'; this.code = code; }
}
const fail = code => { throw new CheckedGunzipError(code); };
// Supply exports from ONE dedicated, trusted, exact ABI WASM instance. Synchronous,
// exclusive use: do not share allocator/memory with concurrent or reentrant calls.
export const CHECKED_GUNZIP_STATUS_VERSION = 1;
export function createCheckedGunzip(wasm) {
  for (const name of ['__malloc', '__free', 'libdeflate_alloc_decompressor',
    'libdeflate_free_decompressor', 'libdeflate_gzip_decompress']) {
    if (typeof wasm?.[name] !== 'function') fail('abi');
  }
  if (!(wasm.memory instanceof WebAssembly.Memory)) fail('abi');
  let busy = false, poisoned = false;
  const policy = EXPERIMENTAL_POLICY;
  const gunzip = function gunzip(input) {
    if (busy || poisoned) fail('instance-unavailable');
    if (!(input instanceof Uint8Array) || (typeof SharedArrayBuffer !== 'undefined' && input.buffer instanceof SharedArrayBuffer)) fail('input-type');
    const n = input.byteLength;
    if (n < 20) fail('input-short'); // 10 header + >=2 DEFLATE + 8 trailer
    if (n > policy.maxInputBytes) fail('input-limit');
    // Stable private snapshot, supports Buffer and nonzero byteOffset. No WASM allocation yet.
    const bytes = Uint8Array.prototype.slice.call(input);
    if (bytes[0] !== 31 || bytes[1] !== 139 || bytes[2] !== 8 || (bytes[3] & 224)) fail('header');
    const flags = bytes[3], end = n - 8;
    let p = 10;
    if (flags & 4) {
      if (p + 2 > end) fail('header');
      const len = bytes[p] | (bytes[p + 1] << 8); p += 2;
      if (p + len > end) fail('header'); p += len;
    }
    for (const flag of [8, 16]) if (flags & flag) {
      while (p < end && bytes[p] !== 0) p++;
      if (p >= end) fail('header'); p++;
    }
    // Upstream skips FHCRC validation; this experimental subset rejects it explicitly.
    if (flags & 2) fail('header-crc-unsupported');
    if (p + 2 > end) fail('input-short');
    // Unsigned LE ISIZE, independent of unsafe C signed footer helper.
    const size = new DataView(bytes.buffer, bytes.byteOffset, n).getUint32(n - 4, true);
    if (size > policy.maxOutputBytes || size > n * policy.maxExpansionRatio + policy.expansionSlackBytes) fail('output-limit');
    // Conservative allowance for known allocator/context + page rounding. This is an
    // admission bound on a dedicated trusted module, not a WASM-enforced memory maximum.
    if (wasm.memory.buffer.byteLength + n + Math.max(size, 1) + policy.allocatorReserveBytes > policy.maxMemoryBytes) fail('memory-limit');
    let ip = 0, op = 0, ctx = 0, result, error;
    busy = true;
    const view = () => new Uint8Array(wasm.memory.buffer); // refresh AFTER every WASM call
    const range = (ptr, len) => {
      ptr = ptr >>> 0;
      if (!ptr || ptr + len > wasm.memory.buffer.byteLength || wasm.memory.buffer.byteLength > policy.maxMemoryBytes) fail('allocation');
      return ptr;
    };
    try {
      ip = wasm.__malloc(n) >>> 0; range(ip, n);
      op = wasm.__malloc(Math.max(1, size)) >>> 0; range(op, Math.max(1, size));
      ctx = wasm.libdeflate_alloc_decompressor() >>> 0; range(ctx, 1);
      view().set(bytes, ip);
      // This ABI hides actual_out_nbytes. A short-capacity probe prevents stale tail
      // exposure when a valid first member plus trailing data advertises a larger size.
      // Probe output is NEVER returned. 3 is expected only in this diagnostic call.
      if (size > 0) {
        const probe = wasm.libdeflate_gzip_decompress(ctx, ip, n, op, size - 1);
        if (probe !== 3) fail(probe === 0 ? 'output-length' : `c-return-${probe}`);
      }
      const ret = wasm.libdeflate_gzip_decompress(ctx, ip, n, op, size);
      if (ret !== 0) fail(`c-return-${ret}`);
      range(op, Math.max(1, size));
      result = view().slice(op, op + size); // owning copy, survives free/growth
    } catch (e) {
      if (!(e instanceof CheckedGunzipError)) poisoned = true;
      if (e instanceof CheckedGunzipError && e.code === 'allocation') poisoned = true;
      error = e instanceof CheckedGunzipError ? e : new CheckedGunzipError('wasm-failure');
    } finally {
      // Reverse allocation order; independently attempt all cleanups, even on throw.
      for (const [ptr, release] of [[ctx, wasm.libdeflate_free_decompressor], [op, wasm.__free], [ip, wasm.__free]]) {
        if (ptr) try { release(ptr); } catch { poisoned = true; error ??= new CheckedGunzipError('cleanup'); }
      }
      busy = false;
    }
    if (error) throw error;
    return result;
  };
  // Status v1: own, read-only, non-configurable, terminal-only closure state.
  // No callback/observer, raw exports, memory or error inspection. Callable API unchanged.
  Object.defineProperty(gunzip, 'terminal', { get: () => poisoned, enumerable: true });
  return Object.freeze(gunzip);
}

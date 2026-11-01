export function resolveRange(header: string | null, length: number): {start: number; end: number; partial: boolean} | null {
  if (!Number.isSafeInteger(length) || length <= 0) return null;
  if (!header || header.includes(',')) return {start: 0, end: length, partial: false};
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return {start: Math.max(0, length - suffix), end: length, partial: true};
  }
  const start = Number(match[1]); const end = match[2] ? Number(match[2]) + 1 : length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= length || start >= end) return null;
  return {start, end: Math.min(end, length), partial: true};
}

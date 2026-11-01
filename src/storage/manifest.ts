import type {Fixture, Manifest} from './assets';
export function validFixture(fixture: Fixture): boolean {
  return typeof fixture.id === 'string' && fixture.id.length > 0 && fixture.id.length <= 100 &&
    Number.isSafeInteger(fixture.bytes) && fixture.bytes > 0 && fixture.bytes <= 1024 * 1024 &&
    ['audio/mpeg', 'audio/mp4'].includes(fixture.mime) && /^[a-f0-9]{64}$/.test(fixture.sha256);
}
export function validManifest(value: unknown, fixture: Fixture): value is Manifest {
  if (!value || typeof value !== 'object' || !validFixture(fixture)) return false;
  const manifest = value as Partial<Manifest>;
  return manifest.id === fixture.id && manifest.namespace === 'local' && manifest.state === 'complete' &&
    manifest.bytes === fixture.bytes && manifest.sha256 === fixture.sha256 && manifest.mime === fixture.mime &&
    typeof manifest.storageKey === 'string' && /^[a-f0-9-]{36}$/.test(manifest.storageKey) &&
    Number.isSafeInteger(manifest.chunks) && manifest.chunks! > 0 && manifest.chunks! <= fixture.bytes &&
    Number.isSafeInteger(manifest.revision) && manifest.revision! > 0;
}

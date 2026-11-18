import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const bundled = fileURLToPath(new URL('../node_modules/@ffmpeg-installer/linux-x64/ffmpeg', import.meta.url));
let executable;

// Resolve lazily so tests that never encode fixtures can still run.
export function ffmpegExecutable() {
  if (executable) return executable;
  const candidate = process.env.FFMPEG_PATH ||
    (process.platform === 'linux' && process.arch === 'x64' && existsSync(bundled) ? bundled : 'ffmpeg');
  const {status} = spawnSync(candidate, ['-version'], {stdio: 'ignore', timeout: 5000});
  if (status !== 0) throw new Error('FFmpeg no disponible para generar fixtures. Instálalo en PATH o configura FFMPEG_PATH.');
  executable = candidate;
  return executable;
}

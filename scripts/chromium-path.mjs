import {accessSync, constants, statSync} from 'node:fs';

const candidate = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

export const chromiumPath = (() => {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
})();

export const chromiumSkipReason = `Chromium no disponible en ${candidate}; indica un ejecutable con CHROMIUM_PATH.`;

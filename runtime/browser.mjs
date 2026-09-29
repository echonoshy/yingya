import {accessSync, constants, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';

export function browserPath() {
  const executable = process.env.YINGYA_BROWSER_PATH || chromium.executablePath();
  try {accessSync(executable, constants.X_OK); return realpathSync(executable);}
  catch {throw Error('Chromium is unavailable; run npm run browser:ensure or configure YINGYA_BROWSER_PATH');}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(browserPath());} catch (error) {console.error(error.message); process.exitCode = 1;}
}

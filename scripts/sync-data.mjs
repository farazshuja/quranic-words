import {access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const source = new URL('../../quranic-usage-text/', import.meta.url);
const exporter = new URL('scripts/export-web-data.mjs', source);
const target = fileURLToPath(new URL('../data/', import.meta.url));

export async function syncData({optional = false} = {}) {
  try {
    await access(fileURLToPath(source));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return;
    throw error;
  }
  execFileSync(process.execPath, [fileURLToPath(exporter), target], {stdio: 'inherit'});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await syncData();

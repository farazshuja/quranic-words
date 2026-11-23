import {access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The exporter now lives in this project (scripts/export-web-data.mjs) and
// reads the private master data folder directly, so features and any other
// new public fields flow through without touching the private repository.
const exporter = fileURLToPath(new URL('./export-web-data.mjs', import.meta.url));
const master = fileURLToPath(new URL('../../../quranic-usage-text/quranic-usage-text/data/', import.meta.url));
const target = fileURLToPath(new URL('../data/', import.meta.url));

export async function syncData({optional = false} = {}) {
  try {
    await access(master);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return;
    throw error;
  }
  execFileSync(process.execPath, [exporter, target], {stdio: 'inherit'});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await syncData();

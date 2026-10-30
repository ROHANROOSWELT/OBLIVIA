// Exports compiled ABIs from forge out/ into hub/views/assets for the browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'contracts', 'out');
const DST = path.join(ROOT, 'hub', 'views', 'assets');

function readAbi(name) {
  const file = path.join(OUT, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error('missing artifact: ' + file);
  return JSON.parse(fs.readFileSync(file, 'utf8')).abi;
}

for (const name of ['EraseRegistry', 'PolicyRegistry']) {
  const abi = readAbi(name);
  fs.writeFileSync(
    path.join(DST, `${name.toLowerCase()}-abi.json`),
    JSON.stringify(abi),
  );
  console.log(`exported ${name} -> ${name.toLowerCase()}-abi.json (${abi.length} fragments)`);
}

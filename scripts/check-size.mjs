// Bundle size budget (issue #8). Fails CI when a chunk's gzip size grows past
// its budget so regressions are caught at PR time. Budgets in kB (gzip).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGETS_KB = {
  index: 120,    // app code
  three: 160,    // three.js vendor chunk
  rapier: 800,   // rapier wasm-in-js (compat) chunk
  bundler: 40,   // peerjs (lazy-loaded)
};

const dir = join(process.cwd(), 'dist', 'assets');
let failed = false;
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.js')) continue;
  const prefix = file.split('-')[0];
  const budget = BUDGETS_KB[prefix];
  const gzipKb = gzipSync(readFileSync(join(dir, file))).length / 1024;
  const line = `${file.padEnd(28)} ${gzipKb.toFixed(1).padStart(8)} kB gzip`;
  if (budget === undefined) {
    console.log(`${line}  (no budget)`);
    continue;
  }
  const ok = gzipKb <= budget;
  console.log(`${line}  budget ${budget} kB  ${ok ? 'OK' : 'OVER BUDGET'}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error('\nBundle size budget exceeded — adjust scripts/check-size.mjs only with justification.');
  process.exit(1);
}

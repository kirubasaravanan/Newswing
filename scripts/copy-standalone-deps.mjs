/**
 * Copies serverExternalPackages that are not bundled by webpack/turbopack
 * into .next/standalone/node_modules/ so the standalone server can require them.
 */
import { cpSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const standaloneModules = join(root, '.next/standalone/node_modules');
const srcModules = join(root, 'node_modules');

const PACKAGES = [
  'technicalindicators',
];

let copied = 0;
for (const pkg of PACKAGES) {
  const src = join(srcModules, pkg);
  const dest = join(standaloneModules, pkg);
  if (existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    if (!existsSync(dest)) {
      cpSync(src, dest, { recursive: true, force: true });
      copied++;
      console.log(`  Copied: ${pkg}`);
    } else {
      console.log(`  Exists: ${pkg}`);
    }
  } else {
    console.warn(`  Missing: ${pkg}`);
  }
}

console.log(`\nStandalone deps: ${copied} packages copied`);
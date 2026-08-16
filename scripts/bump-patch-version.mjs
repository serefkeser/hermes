import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageFiles = [
  'package.json',
  'apps/web/package.json',
  'packages/shared-config/package.json',
  'packages/shared-types/package.json',
  'packages/shared-utils/package.json',
  'services/api-gateway/package.json',
  'services/media-storage/package.json',
  'services/video-renderer/package.json',
];
const sourceFiles = [
  'services/api-gateway/src/index.ts',
  'services/api-gateway/src/routes/health.ts',
  'services/video-renderer/src/index.ts',
];

const rootPackagePath = resolve(root, 'package.json');
const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
const [major, minor, patch] = String(rootPackage.version).split('.').map(Number);
if (![major, minor, patch].every(Number.isInteger)) throw new Error(`Geçersiz sürüm: ${rootPackage.version}`);
const nextVersion = `${major}.${minor}.${patch + 1}`;

for (const relativePath of packageFiles) {
  const path = resolve(root, relativePath);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  data.version = nextVersion;
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (!data[section]) continue;
    for (const name of Object.keys(data[section])) {
      if (name.startsWith('@otonom/')) data[section][name] = `^${nextVersion}`;
    }
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

const webVersionPath = resolve(root, 'apps/web/src/version.ts');
const webVersionSource = readFileSync(webVersionPath, 'utf8')
  .replace(/APP_VERSION = '\d+\.\d+\.\d+'/, `APP_VERSION = '${nextVersion}'`);
writeFileSync(webVersionPath, webVersionSource);

for (const relativePath of sourceFiles) {
  const path = resolve(root, relativePath);
  const source = readFileSync(path, 'utf8').replace(/version:\s*'\d+\.\d+\.\d+'/g, `version: '${nextVersion}'`);
  writeFileSync(path, source);
}

console.log(`OTONOM sürümü ${rootPackage.version} -> ${nextVersion} olarak güncellendi.`);

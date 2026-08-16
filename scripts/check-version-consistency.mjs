import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const packageFiles = [
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
const problems = [];

for (const relativePath of packageFiles) {
  const data = JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
  if (data.version !== version) problems.push(`${relativePath}: version=${data.version}`);
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, value] of Object.entries(data[section] || {})) {
      if (name.startsWith('@otonom/') && value !== `^${version}`) problems.push(`${relativePath}: ${name}=${value}`);
    }
  }
}

const webVersion = readFileSync(resolve(root, 'apps/web/src/version.ts'), 'utf8');
if (!webVersion.includes(`APP_VERSION = '${version}'`)) problems.push('apps/web/src/version.ts: ekran sürümü uyumsuz');
for (const relativePath of sourceFiles) {
  const source = readFileSync(resolve(root, relativePath), 'utf8');
  if (!source.includes(`version: '${version}'`)) problems.push(`${relativePath}: health sürümü uyumsuz`);
}
if (problems.length) {
  console.error(`OTONOM sürüm tutarsızlığı (${version}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`OTONOM sürümü tutarlı: ${version}`);

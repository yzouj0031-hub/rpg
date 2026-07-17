import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const androidDir = path.join(rootDir, 'android');
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');

let manifest = await readFile(manifestPath, 'utf8');
if (!manifest.includes('android:screenOrientation="landscape"')) {
  manifest = manifest.replace(
    /<activity\s+/,
    '<activity\n            android:screenOrientation="landscape"\n            '
  );
}
await writeFile(manifestPath, manifest);

const launcherSource = path.join(rootDir, 'icons', 'icon-512.png');
const resourceDir = path.join(androidDir, 'app', 'src', 'main', 'res');
const resourceFolders = await readdir(resourceDir, { withFileTypes: true });
let iconCount = 0;

for (const folder of resourceFolders) {
  if (!folder.isDirectory() || !folder.name.startsWith('mipmap-')) continue;
  const folderPath = path.join(resourceDir, folder.name);
  const files = await readdir(folderPath);
  for (const file of files) {
    if (!/^ic_launcher(?:_round|_foreground)?\.png$/.test(file)) continue;
    await copyFile(launcherSource, path.join(folderPath, file));
    iconCount += 1;
  }
}

console.log(`Android 已锁定横屏，并更新 ${iconCount} 个启动图标资源。`);

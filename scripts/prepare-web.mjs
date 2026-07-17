import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const webDir = path.join(rootDir, 'www');

const threeCdnUrl = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const tracks = [
  {
    url: "https://raw.githubusercontent.com/yzouj0031-hub/bgm/main/Death%20Note%20-%20Yoshihisa%20Hirano%20And%20Hideki%20Taniuchi%20-%20L%27s%20Theme%20B.mp3",
    localPath: 'assets/audio/explore-l-theme-b.mp3'
  },
  {
    url: 'https://raw.githubusercontent.com/yzouj0031-hub/bgm/main/BLESSED%20MANE%20-%20Death%20Is%20No%20More.mp3',
    localPath: 'assets/audio/danger-death-is-no-more.mp3'
  },
  {
    url: "https://raw.githubusercontent.com/yzouj0031-hub/bgm/main/Death%20Note%20-%20%28Kira%27s%20Theme%20A%29%20Music.mp3",
    localPath: 'assets/audio/bridge-kira-theme-a.mp3'
  }
];

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`下载失败 (${response.status}): ${url}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length < 1024) {
    throw new Error(`下载内容异常 (${body.length} bytes): ${url}`);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, body);
}

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

for (const file of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  await copyFile(path.join(rootDir, file), path.join(webDir, file));
}
await cp(path.join(rootDir, 'icons'), path.join(webDir, 'icons'), { recursive: true });
await cp(path.join(rootDir, 'assets'), path.join(webDir, 'assets'), { recursive: true });

await mkdir(path.join(webDir, 'vendor'), { recursive: true });
await copyFile(
  path.join(rootDir, 'node_modules', 'three', 'build', 'three.min.js'),
  path.join(webDir, 'vendor', 'three.min.js')
);

await Promise.all(
  tracks.map(({ url, localPath }) => download(url, path.join(webDir, localPath)))
);

let html = await readFile(path.join(webDir, 'index.html'), 'utf8');
html = html.replaceAll(threeCdnUrl, 'vendor/three.min.js');
for (const { url, localPath } of tracks) {
  html = html.replaceAll(url, localPath);
}
await writeFile(path.join(webDir, 'index.html'), html);

let serviceWorker = await readFile(path.join(webDir, 'sw.js'), 'utf8');
serviceWorker = serviceWorker
  .replaceAll('di13jie-v5', 'di13jie-apk-v1')
  .replaceAll(threeCdnUrl, 'vendor/three.min.js');
for (const { url, localPath } of tracks) {
  serviceWorker = serviceWorker.replaceAll(url, localPath);
}
await writeFile(path.join(webDir, 'sw.js'), serviceWorker);

console.log(`Android Web 资源已生成：${webDir}`);

const CACHE='di13jie-v5';
const CORE=['.','index.html','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png',
  'assets/ghost/ghost-bride-sprite.webp','assets/ghost/ghost-bride-scare.webp',
  'https://raw.githubusercontent.com/yzouj0031-hub/bgm/main/Death%20Note%20-%20Yoshihisa%20Hirano%20And%20Hideki%20Taniuchi%20-%20L%27s%20Theme%20B.mp3',
  'https://raw.githubusercontent.com/yzouj0031-hub/bgm/main/BLESSED%20MANE%20-%20Death%20Is%20No%20More.mp3',
  'https://raw.githubusercontent.com/yzouj0031-hub/bgm/main/Death%20Note%20-%20%28Kira%27s%20Theme%20A%29%20Music.mp3',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(res=>{
      const cp=res.clone();caches.open(CACHE).then(c=>c.put('index.html',cp));return res;
    }).catch(()=>caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
    const cp=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return res;
  })));
});

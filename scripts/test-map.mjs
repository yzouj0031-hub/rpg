import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('const MW=');
const end = html.indexOf('function wallAt', start);
assert.ok(start >= 0 && end > start, '找不到地图定义');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${html.slice(start, end)}\nglobalThis.__map={MAP,MW,MH};`, sandbox, { filename: 'map-definition.js' });
const { MAP, MW, MH } = sandbox.__map;

assert.equal(MW, 32);
assert.equal(MH, 22);
assert.equal(MAP.length, MH);
assert.ok(MAP.every(row => row.length === MW), '地图每一行宽度必须一致');
assert.ok(MAP.some(row => row.includes('P')), '缺少旧音乐教室材质区');
assert.ok(MAP.some(row => row.includes('A')), '缺少封存档案室材质区');
assert.ok(MAP.some(row => row.includes('R')), '缺少地下层材质区');

const open = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && MAP[y][x] === '.';
const queue = [[2, 2]];
const seen = new Set(['2,2']);
for (let i = 0; i < queue.length; i++) {
  const [x, y] = queue[i];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
    if (open(nx, ny) && !seen.has(key)) { seen.add(key); queue.push([nx, ny]); }
  }
}

const storyPoints = {
  '开场纸条': [2, 3], '校史墙': [1, 6], '洗手间水槽': [17, 1], '镜子': [18, 3],
  '储物柜': [15, 8], '楼梯间旧伞': [6, 11], '后门': [8, 12],
  '保安值班室': [3, 16], '工具柜': [13, 16], '地下配电箱': [16, 20],
  '封存档案': [26, 13], '旧钢琴': [26, 4], '地下供桌': [4, 20]
};
for (const [name, [x, y]] of Object.entries(storyPoints)) {
  assert.ok(open(x, y), `${name} 不在可行走地块上`);
  assert.ok(seen.has(`${x},${y}`), `${name} 无法从出生点抵达`);
}
assert.ok(seen.size >= 300, `可探索面积过小：${seen.size}`);

console.log(`扩建地图 ${MW}×${MH}、${seen.size} 个连通地块与全部剧情点测试通过。`);

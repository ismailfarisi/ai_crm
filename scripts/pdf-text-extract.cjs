const fs = require('fs'), zlib = require('zlib');
const buf = fs.readFileSync(process.argv[2]);
const out = [];
let idx = 0;
while (true) {
  const s = buf.indexOf('stream', idx);
  if (s < 0) break;
  let start = s + 6;
  if (buf[start] === 13) start++;
  if (buf[start] === 10) start++;
  const e = buf.indexOf('endstream', start);
  if (e < 0) break;
  const data = buf.slice(start, e);
  try {
    const dec = zlib.inflateSync(data);
    const txt = dec.toString('latin1');
    const parts = [];
    const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj|\[((?:[^\][]|\([^)]*\))*)\]\s*TJ/g;
    let m;
    while ((m = re.exec(txt))) {
      if (m[1] !== undefined) parts.push(m[1]);
      else {
        const segs = [...m[2].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map(x => x[1]).join('');
        parts.push(segs);
      }
    }
    if (parts.length) out.push(parts.join('\n'));
  } catch (_) {}
  idx = e + 9;
}
const unesc = s => s.replace(/\\([()\\])/g, '$1').replace(/\\r/g, '\r').replace(/\\n/g, '\n');
console.log(unesc(out.join('\n---\n')));

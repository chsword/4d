'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

function close(a, b, tolerance = 1e-10) {
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
}
function vectorClose(a, b) {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => close(v, b[i]));
}
function distance(a, b) {
  return Math.hypot(...a.map((v, i) => v - b[i]));
}
function determinant(matrix) {
  if (matrix.length === 1) return matrix[0][0];
  return matrix[0].reduce((sum, value, column) => {
    const minor = matrix.slice(1).map(row => row.filter((_, i) => i !== column));
    return sum + (column % 2 ? -1 : 1) * value * determinant(minor);
  }, 0);
}
function materialVolume(points) {
  const basis = points.slice(1).map(p => p.map((v, i) => v - points[0][i]));
  const gram = basis.map(a => basis.map(b => a.reduce((sum, v, i) => sum + v * b[i], 0)));
  return Math.sqrt(determinant(gram)) / 6;
}

function loadPage(filename, options = {}) {
  const html = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  assert.ok(!/<script\b[^>]*\bsrc\s*=|type\s*=\s*["']module["']|<link\b[^>]*href\s*=\s*["']https?:/i.test(html));
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);
  assert.equal(scripts.length, 2);
  scripts.forEach((script, i) => {
    const result = spawnSync(process.execPath, ['--check'], { input: script, encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${filename} script ${i}: ${result.stderr}`);
  });
  const nodes = new Map(), buttons = [], frames = new Map(), calls = [];
  let nextFrame = 1;
  function eventTarget() {
    const listeners = new Map();
    return {
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
      },
      emit(name) {
        (listeners.get(name) || []).forEach(callback => callback.call(this, { target: this }));
      }
    };
  }
  function node(tag, attrs) {
    const target = Object.assign(eventTarget(), {
      tagName: tag.toUpperCase(), dataset: {}, textContent: '', hidden: 'hidden' in attrs,
      setAttribute(name, value) { attrs[name] = value; },
      getAttribute(name) { return attrs[name]; }
    });
    if (attrs['data-cell'] !== undefined) target.dataset.cell = attrs['data-cell'];
    let value = attrs.value || '';
    Object.defineProperty(target, 'value', {
      get() { return value; },
      set(next) {
        if (attrs.type === 'range') {
          const min = Number(attrs.min), max = Number(attrs.max), step = Number(attrs.step || 1);
          const number = Math.max(min, Math.min(max, Number(next)));
          assert.ok(Number.isFinite(number));
          value = String(Math.max(min, Math.min(max, min + Math.round((number - min) / step) * step)));
        } else value = String(next);
      }
    });
    if (tag === 'canvas') {
      const sizes = { moving: [480, 350], target: [480, 350], trace: [300, 220], net: [760, 570], local: [285, 235] };
      const size = sizes[attrs.id];
      target.getBoundingClientRect = () => ({ width: options.mobile ? Math.min(size[0], 328) : size[0], height: size[1] });
      const context = {};
      for (const method of ['setTransform', 'fillRect', 'moveTo', 'lineTo', 'arc', 'fillText']) {
        context[method] = (...args) => {
          const numbers = method === 'fillText' ? args.slice(1) : args;
          numbers.forEach(n => assert.ok(typeof n === 'number' && Number.isFinite(n), `${filename} ${method}: ${args}`));
          calls.push({ canvas: attrs.id, method, args });
        };
      }
      for (const method of ['beginPath', 'closePath', 'fill', 'stroke']) context[method] = () => {};
      context.setLineDash = values => values.forEach(n => assert.ok(Number.isFinite(n)));
      target.getContext = type => {
        assert.equal(type, '2d');
        return options.noCanvas ? null : context;
      };
    }
    return target;
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const attrs = Object.fromEntries(Array.from(match[2].matchAll(/([\w-]+)="([^"]*)"/g), m => [m[1], m[2]]));
    if (/\bhidden\b/.test(match[2])) attrs.hidden = '';
    if (!attrs.id && attrs['data-cell'] === undefined) continue;
    const target = node(match[1], attrs);
    if (attrs.id) { assert.ok(!nodes.has(attrs.id)); nodes.set(attrs.id, target); }
    if (attrs['data-cell'] !== undefined) buttons.push(target);
  }
  for (const match of html.matchAll(/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    nodes.get(match[1]).value = /<option value="([^"]+)"/.exec(match[2])[1];
  }
  const document = Object.assign(eventTarget(), {
    hidden: false,
    getElementById(id) { assert.ok(nodes.has(id), `Missing ${id}`); return nodes.get(id); },
    querySelectorAll(selector) { assert.equal(selector, '[data-cell]'); return buttons; }
  });
  const sandbox = Object.assign(eventTarget(), {
    document, console, devicePixelRatio: 2,
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  scripts.forEach(script => vm.runInContext(script, sandbox, { filename }));
  return {
    sandbox, nodes, buttons, calls, frames,
    set(id, value, event = 'input') { nodes.get(id).value = value; nodes.get(id).emit(event); },
    click(id) { nodes.get(id).emit('click'); },
    frame(now) {
      const pending = Array.from(frames.entries());
      pending.forEach(([id, callback]) => { frames.delete(id); callback(now); });
    }
  };
}

const chirality = loadPage('chirality.html');
const ch = chirality.sandbox.ChiralityMath;
const originalVolume = ch.volume(ch.witness);
assert.ok(originalVolume > 0);
const materialPoints = ch.hand.flatMap(part => Array.from(part.vertices));
for (const point of [...ch.witness, ...ch.pair]) {
  assert.ok(ch.hand.some(part => {
    const origin = part.vertices[0], delta = point.map((v, i) => v - origin[i]);
    const basis = [1, 2, 4].map(i => part.vertices[i].map((v, axis) => v - origin[axis]));
    const coefficients = basis.map(b => delta.reduce((sum, v, i) => sum + v * b[i], 0) / b.reduce((sum, v) => sum + v * v, 0));
    if (coefficients.some(t => t < -1e-10 || t > 1 + 1e-10)) return false;
    const reconstructed = origin.map((v, i) => v + basis.reduce((sum, b, j) => sum + coefficients[j] * b[i], 0));
    return distance(point, reconstructed) < 1e-10;
  }), 'Witness and tracked points must be actual material points');
}
const basis4 = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i === j ? 1 : 0));
for (const plane of ['xy', 'xz', 'yz', 'xw']) {
  for (let step = 0; step <= 180; step++) {
    const angle = step * Math.PI / 180;
    const columns = basis4.map(p => ch.rotate(p, plane, angle));
    close(determinant(columns), 1);
    columns.forEach((a, i) => columns.forEach((b, j) => {
      close(a.reduce((sum, v, k) => sum + v * b[k], 0), i === j ? 1 : 0);
    }));
    const points = ch.witness.map(p => ch.rotate(p, plane, angle));
    close(ch.volume(points) / originalVolume, plane === 'xw' ? Math.cos(angle) : 1);
    close(materialVolume(points), originalVolume);
    for (let i = 0; i < materialPoints.length; i += 3) {
      const a = materialPoints[i], b = materialPoints[(i + 17) % materialPoints.length];
      close(distance(ch.rotate(a, plane, angle), ch.rotate(b, plane, angle)), distance(a, b));
    }
  }
}
materialPoints.forEach(p => vectorClose(ch.rotate(p, 'xw', Math.PI), [-p[0], p[1], p[2], 0]));
const midpoint = ch.pair.map(p => ch.rotate(p, 'xw', Math.PI / 2));
close(distance(midpoint[0], midpoint[1]), 1.2);
close(Math.abs(midpoint[1][3] - midpoint[0][3]), 1.2);
close(midpoint[0][0], 0);
close(midpoint[1][0], 0);
chirality.click('middle');
assert.match(chirality.nodes.get('status').textContent, /投影失去一个方向/);
chirality.click('end');
assert.match(chirality.nodes.get('status').textContent, /所有材料点/);
for (const plane of ['xy', 'xz', 'yz']) {
  chirality.set('mode', plane, 'change');
  assert.match(chirality.nodes.get('volume').textContent, /1\.000/);
}
chirality.set('mode', 'xw', 'change');
for (const camera of ['front', 'back', 'oblique']) chirality.set('camera', camera, 'change');
console.log('PASS chirality: SO(4), material rigidity/volume, mirror endpoint, UI comparisons');

const net = loadPage('tesseract-net.html');
const nm = net.sandbox.NetMath;
for (let step = 0; step <= 100; step++) {
  const t = step / 100;
  nm.cells.forEach((cell, index) => {
    const points = nm.vertices(index, t);
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) close(distance(points[i], points[j]), distance(nm.corners[i], nm.corners[j]));
    }
    if (index > 0 && index < 7) {
      const axes = [0, 1, 2].filter(a => a !== cell.axis);
      for (const u of [-1, 0, 1]) {
        for (const v of [-1, 0, 1]) {
          const a = [0, 0, 0, 0], b = [0, 0, 0, 0];
          a[cell.axis] = cell.sign; b[cell.axis] = -cell.sign;
          a[axes[0]] = b[axes[0]] = u; a[axes[1]] = b[axes[1]] = v;
          vectorClose(nm.point(0, a, t), nm.point(index, b, t));
        }
      }
    }
  });
  for (const x of [-1, 0, 1]) {
    for (const z of [-1, 0, 1]) vectorClose(nm.point(4, [x, 1, z, 0], t), nm.point(7, [x, -1, z, 0], t));
  }
  if (t >= 0.5) nm.vertices(7, t).forEach(p => assert.ok(p[3] >= 2 - 1e-10));
  if (step === 50) {
    for (let index = 0; index < 8; index++) {
      nm.vertices(index, t - 1e-9).forEach((p, i) => assert.ok(distance(p, nm.vertices(index, t + 1e-9)[i]) < 1e-6));
    }
  }
  net.calls.length = 0;
  net.set('progress', step * 10);
  net.calls.filter(call => call.canvas === 'net' && ['moveTo', 'lineTo'].includes(call.method))
    .forEach(call => {
      assert.ok(call.args[0] >= 0 && call.args[0] <= 760, `Net x outside viewport: ${call.args}`);
      assert.ok(call.args[1] >= 0 && call.args[1] <= 570, `Net y outside viewport: ${call.args}`);
    });
}
const pointKey = p => p.map(v => {
  const rounded = Math.round(v);
  close(v, rounded);
  return rounded === 0 ? 0 : rounded;
}).join(',');
const vertices = new Map(), edges = new Map(), faces = new Map();
const add = (map, key, cell) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(cell);
};
nm.cells.forEach((cell, index) => {
  const points = nm.vertices(index, 1), keys = points.map(pointKey);
  points.forEach(p => {
    close(p[cell.axis], cell.axis === 3 ? (cell.sign < 0 ? 0 : 2) : cell.sign);
    p.forEach((v, i) => assert.ok(i === 3 ? v >= -1e-10 && v <= 2 + 1e-10 : Math.abs(v) <= 1 + 1e-10));
  });
  keys.forEach(key => add(vertices, key, index));
  nm.edges.forEach(edge => add(edges, Array.from(edge, i => keys[i]).sort().join('|'), index));
  nm.faces.forEach(face => add(faces, Array.from(face, i => keys[i]).sort().join('|'), index));
});
assert.equal(vertices.size, 16);
assert.equal(edges.size, 32);
assert.equal(faces.size, 24);
vertices.forEach(owners => assert.equal(owners.length, 4));
edges.forEach(owners => assert.equal(owners.length, 3));
faces.forEach(owners => assert.equal(new Set(owners).size, 2));
nm.cells.forEach((_, index) => {
  const adjacent = new Set();
  faces.forEach(owners => { if (owners.includes(index)) owners.forEach(owner => { if (owner !== index) adjacent.add(owner); }); });
  assert.equal(adjacent.size, 6);
  assert.deepEqual([...adjacent].sort(), Array.from(nm.neighbors(index)).sort());
});
net.buttons.forEach(button => {
  button.emit('click');
  const index = Number(button.dataset.cell);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.match(net.nodes.get('cell-info').textContent, new RegExp(nm.cells[index].name));
  assert.equal(net.buttons.filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
});
net.click('sides'); assert.equal(net.nodes.get('progress').value, '500');
net.click('closed'); assert.match(net.nodes.get('status').textContent, /24 面/);
for (const angle of [-65, 0, 65]) net.set('pitch', angle);
for (const angle of [-180, 0, 180]) net.set('yaw', angle);
console.log('PASS net: all-cell rigidity, hinges, continuity, cap path, 16/32/24/8 incidence, selection');

for (let step = 0; step <= 30; step++) {
  const phase = step / 10, h = Math.min(phase, 1);
  const shift = phase <= 1 ? 0 : phase < 2 ? (phase - 1) * 3 : 3;
  const w = phase <= 2 ? h : 3 - phase;
  let sampledMin = Infinity;
  for (let i = 0; i < 40; i++) {
    const u = i * Math.PI / 20, a = [Math.cos(u), Math.sin(u), 0, 0];
    for (let j = 0; j < 40; j++) {
      const v = j * Math.PI / 20, b = [1 + Math.cos(v) + shift, 0, Math.sin(v), w];
      sampledMin = Math.min(sampledMin, distance(a, b));
    }
  }
  const lowerBound = phase <= 1 ? Math.sqrt(1 + w * w) : phase < 2 ? 1 : 2;
  assert.ok(sampledMin >= lowerBound - 1e-10);
  assert.ok(sampledMin > 0.2);
}
const tetra = [[1, 1, 1, 0], [1, -1, -1, 0], [-1, 1, -1, 0], [-1, -1, 1, 0]];
const simplex = [...tetra, [0, 0, 0, Math.sqrt(5)]];
simplex.forEach((a, i) => simplex.slice(i + 1).forEach(b => close(distance(a, b), Math.sqrt(8))));
console.log('PASS research constructions: rigid-ring clearance samples and fifth equidistant point');

for (const [page, valueId, resetId, maximum] of [
  [chirality, 'angle', 'reset', 180], [net, 'progress', 'open', 1000]
]) {
  page.calls.length = 0;
  page.click(resetId);
  page.click('play'); page.click('play'); page.click('play');
  assert.equal(page.frames.size, 1, 'Restart must not duplicate pending animation frames');
  for (let frame = 0; frame <= 40; frame++) page.frame(frame * 4);
  assert.ok(Number(page.nodes.get(valueId).value) > 0, 'High-refresh playback must not stall on range quantization');
  for (let frame = 41; frame <= 350 && page.frames.size; frame++) {
    page.calls.length = 0;
    page.frame(160 + (frame - 40) * 50);
  }
  assert.equal(Number(page.nodes.get(valueId).value), maximum);
  assert.equal(page.frames.size, 0);
  page.click(resetId); page.click('play');
  page.sandbox.document.hidden = true; page.sandbox.document.emit('visibilitychange');
  assert.equal(page.frames.size, 0);
}
for (const file of ['chirality.html', 'tesseract-net.html']) {
  const page = loadPage(file, { mobile: true });
  assert.ok(page.calls.length > 0);
  assert.equal(page.frames.size, 0, 'Do not autoplay');
  assert.throws(() => loadPage(file, { noCanvas: true }), /Canvas 2D unavailable/);
}
console.log('PASS runtime smoke checks: finite Canvas calls, mobile sizing, pause/resume, hidden-page stop, explicit failure');
console.log('All checks passed. DOM/Canvas are test doubles, not a real browser or visual review.');

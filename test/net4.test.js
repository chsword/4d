'use strict';
global.window = global;
require('../js/m4.js');
require('../js/net4.js');
require('../js/view-net.js');
const assert = require('assert'), N = Net4, EPS = Number.EPSILON;
let passed = 0, failed = 0, seed = 0xa032026;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function near(a, b, limit, label) {
  assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= limit,
    label + ': ' + a + ' vs ' + b + ' (limit ' + limit + ')');
}
function distance(a, b) { return Math.hypot(...a.map((x, i) => x - b[i])); }
function vector(a, b, limit, label) { a.forEach((x, i) => near(x, b[i], limit, label)); }
function test(name, run) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
}
const times = Array.from({ length: 2049 }, (_, i) => i / 2048);
for (let i = 0; i < 128; i++) times.push(random());
times.push(1e-12, 0.5 - 1e-12, 0.5 + 1e-12, 1 - 1e-12);
const centers = [[0, 0, 0, 0], [-2, 0, 0, 0], [2, 0, 0, 0], [0, -2, 0, 0],
  [0, 2, 0, 0], [0, 0, -2, 0], [0, 0, 2, 0], [0, 4, 0, 0]];
const local = Array.from({ length: 8 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, 0]);
const targetAxes = [3, 0, 0, 1, 1, 2, 2, 3], targetValues = [0, -1, 1, -1, 1, -1, 1, 2];

test('NET identities: eight immutable solid cells, fixed material points and complete local topology', () => {
  assert.deepStrictEqual(N.cells.map(c => c.id), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.deepStrictEqual(N.cells.map(c => c.center), centers);
  assert.deepStrictEqual(N.cells.map(c => c.parent), [-1, 0, 0, 0, 0, 0, 0, 4]);
  assert.deepStrictEqual(N.corners, local);
  assert.strictEqual(N.edges.length, 12); assert.strictEqual(N.faces.length, 6);
  assert.strictEqual(new Set(N.edges.map(e => e.slice().sort((a, b) => a - b).join(','))).size, 12);
  assert(Object.isFrozen(N.cells) && N.cells.every(c => Object.isFrozen(c) && Object.isFrozen(c.center)));
  assert(N.corners.every(Object.isFrozen) && N.markers.every(m => Object.isFrozen(m) && Object.isFrozen(m.p)));
  for (let cell = 0; cell < 8; cell++) {
    vector(N.point(cell, [0, 0, 0, 0], 0), centers[cell], 0, 'unfolded center');
    N.markers.forEach(m => assert(m.p.slice(0, 3).every(x => Math.abs(x) < 1), 'points are in 3D interior'));
  }
  N.edges.forEach(([i, j]) => near(distance(local[i], local[j]), 2, 0, 'local edge'));
  N.faces.forEach((f, i) => {
    assert.strictEqual(new Set(f).size, 4);
    f.forEach(v => near(local[v][i >> 1], i % 2 ? 1 : -1, 0, 'local face identity'));
    f.forEach((v, j) => near(distance(local[v], local[f[(j + 1) % 4]]), 2, 0, 'cyclic square boundary'));
  });
});

test('NET schedule: analytic two-stage angles and independently expanded material coordinates', () => {
  times.forEach(t => {
    const theta = Math.PI / 2 * Math.min(2 * t, 1), phi = Math.PI / 2 * Math.max(2 * t - 1, 0);
    near(N.progress(t).theta, theta, 0, 'theta'); near(N.progress(t).phi, phi, 0, 'phi');
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let cell = 1; cell < 7; cell++) {
      const axis = targetAxes[cell], sign = targetValues[cell];
      local.forEach(p => {
        const want = p.slice(), r = 1 + sign * p[axis];
        want[axis] = sign * (1 + c * r); want[3] = s * r;
        vector(N.point(cell, p, t), want, 4 * EPS, 'NET side hinge axis');
      });
    }
    local.forEach(p => {
      const r = 1 + p[1], want = t <= 0.5
        ? [p[0], 1 + (2 + r) * c, p[2], (2 + r) * s]
        : [p[0], 1 - r * Math.sin(phi), p[2], 2 + r * Math.cos(phi)];
      vector(N.point(7, p, t), want, 8 * EPS, 'NET parent-child order');
    });
  });
});

test('NET rigidity: every vertex pair in every cell over the entire path, never endpoint lerp', () => {
  let max = 0, relative = 0;
  times.forEach(t => {
    const ps = N.geometry(t); let frameMax = 0;
    ps.forEach((vs, cell) => {
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        const ref = distance(local[i], local[j]), error = Math.abs(distance(vs[i], vs[j]) - ref);
        max = Math.max(max, error); frameMax = Math.max(frameMax, error); relative = Math.max(relative, error / ref);
        near(error, 0, 8 * EPS, 'NET rigid pair ' + cell + '/' + i + '/' + j);
      }
      const [p, q] = N.markers.map(m => N.point(cell, m.p, t));
      near(distance(p, q), distance(...N.markers.map(m => m.p)), 8 * EPS, 'interior material ruler');
    });
    near(N.measure(ps), frameMax, 4 * EPS, 'displayed pair drift from current coordinates');
  });
  near(relative, 0, 4 * EPS, 'relative pair drift');
  console.log('  8 × 28 pairs × ' + times.length + ' times; max |Δd|=' + max + ', relative=' + relative);
});

test('NET hinges: the entire square is pointwise fixed during its own rotation', () => {
  // 不只检查四角；仿射变换固定张成该面的一组点，才固定整张面。
  const samples = [-1, -0.71, 0, 0.23, 1];
  times.forEach(t => {
    for (let cell = 1; cell < 8; cell++) {
      const axis = cell === 7 ? 1 : targetAxes[cell], sign = cell === 7 ? 1 : targetValues[cell];
      const free = [0, 1, 2].filter(a => a !== axis);
      samples.forEach(u => samples.forEach(v => {
        const p = [0, 0, 0, 0]; p[axis] = -sign; p[free[0]] = u; p[free[1]] = v;
        if (cell < 7) vector(N.point(cell, p, t), N.point(cell, p, 0), 0, 'NET stationary side hinge');
        else if (t >= 0.5) vector(N.point(cell, p, t), N.point(cell, p, 0.5), 0, 'NET stationary H hinge');
        const parent = cell === 7 ? 4 : 0, pp = p.slice(); pp[axis] = sign;
        vector(N.point(cell, p, t), N.point(parent, pp, t), 4 * EPS, 'NET attached hinge points');
      }));
    }
  });
});

test('NET hinge transform: full SO(4), affine fixed plane and determinant +1', () => {
  function det(a) {
    if (a.length === 1) return a[0][0];
    return a[0].reduce((s, v, i) => s + (i % 2 ? -1 : 1) * v *
      det(a.slice(1).map(r => r.filter((_, j) => j !== i))), 0);
  }
  for (let axis = 0; axis < 3; axis++) {
    for (let k = 0; k <= 256; k++) {
      const angle = 2 * Math.PI * k / 256, origin = N.hinge([0, 0, 0, 0], axis, 0, angle);
      const cols = [0, 1, 2, 3].map(i => N.hinge([0, 1, 2, 3].map(j => +(j === i)), axis, 0, angle)
        .map((x, j) => x - origin[j]));
      near(det(cols), 1, 2 * EPS, 'proper rotation including fourth normal');
      cols.forEach((a, i) => cols.forEach((b, j) =>
        near(a.reduce((s, x, k) => s + x * b[k], 0), +(i === j), 2 * EPS, 'orthogonal')));
      const pivot = 3, p = [0.31, -0.47, 0.61, 0]; p[axis] = pivot;
      vector(N.hinge(p, axis, pivot, angle), p, 0, 'entire fixed plane');
    }
  }
});

// 独立编号，不调用 incidence/seams，也不 round 坐标：先验证终点坐标属于精确目标顶点，
// 再用三个自由轴的位掩码枚举每胞的 6 面、12 棱，防止被测面的漏项自证闭合。
function boundaryLedger() {
  const ps = N.geometry(1), maps = { vertices: new Map(), edges: new Map(), faces: new Map() };
  function add(map, ids, owner) {
    const key = ids.slice().sort((a, b) => a - b).join(',');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(owner);
  }
  ps.forEach((vs, cell) => {
    const ids = vs.map(p => {
      let id = 0;
      p.forEach((x, a) => {
        const lo = a === 3 ? 0 : -1, hi = a === 3 ? 2 : 1;
        const bit = Math.abs(x - hi) < Math.abs(x - lo);
        near(x, bit ? hi : lo, 4 * EPS, 'NET exact target vertex');
        if (bit) id |= 1 << a;
      });
      return id;
    });
    ids.forEach(id => add(maps.vertices, [id], cell));
    for (let axis = 0; axis < 3; axis++) {
      for (let sign = 0; sign < 2; sign++) {
        add(maps.faces, ids.filter((_, i) => ((i >> axis) & 1) === sign), cell);
      }
      for (let i = 0; i < 8; i++) if (!(i & (1 << axis))) add(maps.edges, [ids[i], ids[i | (1 << axis)]], cell);
    }
  });
  return maps;
}
test('NET closure: independently pair every face, edge and vertex, not Euler alone', () => {
  const maps = boundaryLedger();
  [['vertices', 16, 4], ['edges', 32, 3], ['faces', 24, 2]].forEach(([kind, count, multiplicity]) => {
    assert.strictEqual(maps[kind].size, count, kind);
    maps[kind].forEach(owners => {
      assert.strictEqual(owners.length, multiplicity, kind + ' occurrence count');
      assert.strictEqual(new Set(owners).size, multiplicity, kind + ' distinct cells');
    });
  });
  near(maps.vertices.size - maps.edges.size + maps.faces.size - 8, 0, 0, 'Euler secondary check');
  const mesh = N.incidence(N.geometry(1));
  ['vertices', 'edges', 'faces'].forEach(kind => assert.strictEqual(mesh[kind].length, maps[kind].size));
  [['vertices', 4], ['edges', 3], ['faces', 2]].forEach(([kind, count]) => mesh[kind].forEach(item => {
    assert.strictEqual(item.owners.length, count, 'rendered incidence occurrence count');
    assert.strictEqual(new Set(item.owners.map(o => o.cell)).size, count, 'rendered incidence distinct cells');
  }));
});

test('NET seams: 7-edge retained tree and 17 new square pairs, all material points correspond', () => {
  const seams = N.seams(), seen = new Set(), tree = seams.filter(s => s.retained);
  assert.strictEqual(seams.length, 24); assert.strictEqual(tree.length, 7);
  assert.strictEqual(seams.filter(s => !s.retained).length, 17);
  const reached = new Set([0]);
  for (let i = 0; i < 7; i++) tree.forEach(s => {
    if (reached.has(s.a.cell) || reached.has(s.b.cell)) { reached.add(s.a.cell); reached.add(s.b.cell); }
  });
  assert.strictEqual(reached.size, 8, 'seven edges really form a spanning tree');
  seams.forEach(s => {
    [s.a, s.b].forEach(o => { const key = o.cell + ':' + o.face; assert(!seen.has(key)); seen.add(key); });
    if (s.retained) assert(N.cells[s.b.cell].parent === s.a.cell || N.cells[s.a.cell].parent === s.b.cell);
    const pairs = s.pairs;
    // 在正方形内部双线性取点；对应顶点的仿射变换必须给出同一点。
    for (const u of [0, 0.19, 0.5, 1]) for (const v of [0, 0.37, 0.5, 1]) {
      const weights = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
      const material = side => local[0].map((_, a) => pairs.reduce((sum, p, i) => sum + weights[i] * local[p[side]][a], 0));
      vector(N.point(s.a.cell, material(0), 1), N.point(s.b.cell, material(1), 1), 4 * EPS, 'NET whole face paired');
    }
    near(Math.max(...N.seamGaps(s, N.geometry(1))), 0, 4 * EPS, 'closed seam');
    if (s.retained) times.forEach(t => near(Math.max(...N.seamGaps(s, N.geometry(t))), 0, 4 * EPS, 'retained square'));
    else assert(Math.max(...N.seamGaps(s, N.geometry(0))) > 1, 'initially open, not a rounded match');
  });
  assert.strictEqual(seen.size, 48, 'all 48 source faces used exactly once');
  const damaged = N.geometry(1); damaged[7] = damaged[7].map(p => [p[0], p[1], p[2], p[3] + 1e-12]);
  assert(N.incidence(damaged).faces.some(f => f.owners.length === 1), '1e-12 opening cannot be rounded closed');
});

test('NET boundary: union exactly equals all eight facets of [-1,1]^3 x [0,2]', () => {
  N.geometry(1).forEach((vs, cell) => {
    const fixed = targetAxes[cell], free = [0, 1, 2, 3].filter(a => a !== fixed);
    const codes = new Set();
    vs.forEach(p => {
      near(p[fixed], targetValues[cell], 4 * EPS, 'NET target facet');
      let code = 0;
      free.forEach((a, i) => {
        const lo = a === 3 ? 0 : -1, hi = a === 3 ? 2 : 1, bit = p[a] > (lo + hi) / 2;
        near(p[a], bit ? hi : lo, 4 * EPS, 'target free coordinate');
        if (bit) code |= 1 << i;
      });
      codes.add(code);
    });
    assert.strictEqual(codes.size, 8, 'entire facet convex hull, not a subset or repeated corner');
  });
  assert.strictEqual(new Set(targetAxes.map((a, i) => a + ':' + targetValues[i])).size, 8);
});

function separation(a, b) {
  // 本路径有坐标超平面证书。线性泛函的极值在凸胞顶点取得；
  // 至少一侧中心严格离开分隔面，排除“两胞都在 w=0”这种空洞证书。
  for (let axis = 0; axis < 4; axis++) {
    const av = a.map(p => p[axis]), bv = b.map(p => p[axis]);
    for (const [x, y] of [[av, bv], [bv, av]]) {
      const xmax = Math.max(...x), ymin = Math.min(...y);
      if (xmax <= ymin + 8 * EPS &&
          Math.max(ymin - xmax, xmax - Math.min(...x), Math.max(...y) - ymin) > 0.5) return true;
    }
  }
  return false;
}
test('NET nonintersection: every pair has a convex relative-interior separation certificate at sampled times', () => {
  let count = 0;
  times.forEach(t => {
    const ps = N.geometry(t);
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      assert(separation(ps[i], ps[j]), 'NET interior intersection at t=' + t + ', cells=' + i + ',' + j); count++;
    }
    if (t <= 0.5) for (let cell = 1; cell < 7; cell++) {
      ps[cell].forEach(p => assert(targetValues[cell] * p[targetAxes[cell]] >= 1 - 4 * EPS, 'A03 outward support'));
    }
    else {
      ps[7].forEach(p => assert(p[3] >= 2 - 4 * EPS, 'H stays above w=2'));
      ps.slice(0, 7).forEach(vs => vs.forEach(p => assert(p[3] <= 2 + 4 * EPS, 'sides stay below w=2')));
    }
  });
  assert(!separation(local, local), 'coincident interiors rejected');
  assert(!separation(local, local.map(p => [p[0] + 1, p[1], p[2], p[3]])), 'overlapping interiors rejected');
  assert(separation(local, local.map(p => [p[0] + 2, p[1], p[2], p[3]])), 'expected face gluing allowed');
  console.log('  ' + count + ' pair/time certificates; convex supports cover every interior point');
});

test('NET errors: invalid progress, cell identity, material coordinates and hinge rejected', () => {
  [-1, 1.01, NaN, Infinity].forEach(t => assert.throws(() => N.geometry(t), /进度/));
  [-1, 8, 0.5].forEach(i => assert.throws(() => N.point(i, local[0], 0), /编号/));
  assert.throws(() => N.point(0, [0, 0, 0, 1], 0), /材料坐标/);
  assert.throws(() => N.hinge([0, 0, NaN, 0], 0, 1, 0), /有限/);
  assert.throws(() => N.hinge(local[0], 3, 1, 0), /铰链/);
});

function view() {
  const v = Object.create(NetView.prototype);
  Object.assign(v, { t: 0, selected: 0, playing: false, stageInspected: false, cache: null,
    camYaw: 0.6, camPitch: -0.35, mode: 'perspective', seams: N.seams(), seam: 0 });
  return v;
}
test('NET view: exact phase pause, replay, seek, selection and input cleanup preserve identity', () => {
  const v = view(); v.selectCell(7); v.playing = true; v.step(100);
  near(v.t, 0.5, 0, 'cannot skip phase checkpoint'); assert(!v.playing);
  assert.strictEqual(v.snapshot().geometry.joined, 19);
  v.playing = true; v.step(100);
  near(v.t, 1, 0, 'no endpoint wrap'); assert(!v.playing);
  assert.strictEqual(v.snapshot().geometry.joined, 24); assert.strictEqual(v.selected, 7);
  v.selectCell(0); near(v.t, 1, 0, 'find original cell without unfolding');
  v.seek(0.27); v.step(100); near(v.t, 0.27, 0, 'scrub pauses');
  v.playing = true; v.clearInput(); v.step(100); near(v.t, 0.27, 0, 'tab/blur cleanup pauses');
  assert.throws(() => v.step(NaN), /时间/);
});
test('NET view: controlled perspective has no pole, never changes geometry and visibly distinguishes opposite cells', () => {
  const v = view();
  for (const t of times) {
    v.seek(t);
    N.geometry(t).forEach(vs => vs.forEach(p => {
      assert(8 - p[3] >= 4 - 4 * EPS, 'fixed camera denominator');
      vector(v.project4(p), p.slice(0, 3).map(x => x * 7 / (8 - p[3])), 4 * EPS, 'actual perspective');
    }));
  }
  v.seek(1);
  const material = JSON.stringify(v.snapshot()), a = N.vertices(0, 1), h = N.vertices(7, 1);
  near(Math.max(...a.map(p => Math.abs(v.project4(p)[0]))), 7 / 8, 0, 'A projected halfwidth');
  near(Math.max(...h.map(p => Math.abs(v.project4(p)[0]))), 7 / 6, 0, 'H projected halfwidth');
  v.mode = 'ortho'; v.camYaw = -2; v.camPitch = 1;
  assert.strictEqual(JSON.stringify(v.snapshot()), material, 'camera leaves snapshot unchanged');
  near(Math.max(...a.map(p => Math.abs(v.project4(p)[0]))), 1, 0, 'orthographic A');
  near(Math.max(...h.map(p => Math.abs(v.project4(p)[0]))), 1, 0, 'orthographic H really overlaps');
});

if (!passed && !failed) throw new Error('No net tests selected');
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

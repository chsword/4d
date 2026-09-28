'use strict';
global.window = global;
['m4', 'polytopes', 'simplex4', 'view-simplex'].forEach(f => require('../js/' + f + '.js'));
const assert = require('assert'), S = Simplex4, EPS = Number.EPSILON;
let passed = 0, failed = 0, seed = 0xa042026;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function near(a, b, tolerance, label) {
  assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance,
    label + ': ' + a + ' vs ' + b + ', tolerance ' + tolerance);
}
function vector(a, b, tolerance, label) { assert.strictEqual(a.length, b.length); a.forEach((x, i) => near(x, b[i], tolerance, label)); }
function distance(a, b) { return Math.hypot(...a.map((x, i) => x - b[i])); }
function objective(base, p, edge) { return Math.max(...base.map(v => Math.abs(distance(v, p) / edge - 1))); }
function closed(d) { return d === 3 ? (3 * Math.sqrt(6) - 2) / 20 : (3 * Math.sqrt(3) - 1) / 13; }
function test(name, run) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
}
// 独立 Nelder–Mead，不调用模块的 best 或 bound；多起点避免只找到质心的局部极小。
function optimize(base, start, edge, d) {
  const evaluate = p => ({ p, f: objective(base, p, edge) });
  let simplex = [evaluate(start)];
  for (let i = 0; i < d; i++) { const p = start.slice(); p[i] += 0.3 * edge; simplex.push(evaluate(p)); }
  for (let iteration = 0; iteration < 1800; iteration++) {
    simplex.sort((a, b) => a.f - b.f);
    const center = [0, 0, 0, 0];
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) center[j] += simplex[i].p[j] / d;
    const worst = simplex[d], extrapolate = factor => evaluate(center.map((x, j) => x + factor * (x - worst.p[j])));
    const reflected = extrapolate(1);
    if (reflected.f < simplex[0].f) {
      const expanded = extrapolate(2); simplex[d] = expanded.f < reflected.f ? expanded : reflected;
    } else if (reflected.f < simplex[d - 1].f) simplex[d] = reflected;
    else {
      const outside = reflected.f < worst.f, contracted = extrapolate(outside ? 0.5 : -0.5);
      if (contracted.f < (outside ? reflected.f : worst.f)) simplex[d] = contracted;
      else for (let i = 1; i <= d; i++) simplex[i] = evaluate(simplex[i].p.map((x, j) => (x + simplex[0].p[j]) / 2));
    }
    if (iteration > 100 && Math.max(...simplex.map(v => distance(v.p, simplex[0].p))) < 1e-13 * edge) break;
  }
  return simplex.sort((a, b) => a.f - b.f)[0];
}
function rotation3() {
  // 独立的均匀单位四元数公式，避免用被测旋转路径自证不变性。
  const u = random(), a = 2 * Math.PI * random(), b = 2 * Math.PI * random();
  const x = Math.sqrt(1 - u) * Math.sin(a), y = Math.sqrt(1 - u) * Math.cos(a);
  const z = Math.sqrt(u) * Math.sin(b), w = Math.sqrt(u) * Math.cos(b);
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
}

test('SIMPLEX identities and true four-dimensional distance ledger', () => {
  const m = S.create(3, 1);
  assert.deepStrictEqual(m.base, [[1, 1, 1, 0], [1, -1, -1, 0], [-1, 1, -1, 0], [-1, -1, 1, 0]]);
  assert(Object.isFrozen(S.tetra) && S.tetra.every(Object.isFrozen));
  const p = [0.3, -0.7, 0.4, 1.9], points = m.base.concat([p]), rows = S.measure(m, p).rows;
  assert.strictEqual(rows.length, 10); assert.strictEqual(new Set(rows.map(r => r.a + ':' + r.b)).size, 10);
  rows.forEach(r => {
    near(r.distance, distance(points[r.a], points[r.b]), 4 * EPS * m.edge, 'SIMPLEX true 4D distance');
    near(r.error, (distance(points[r.a], points[r.b]) - m.edge) / m.edge, 4 * EPS, 'signed normalized distance');
  });
  const flat = S.measure(m, [0, 0, 0, 0]), raised = S.measure(m, [0, 0, 0, Math.sqrt(5)]);
  assert(flat.maxError > 0.38 && raised.maxError < 4 * EPS, 'identical xyz shadows must have different metric evidence');
});

test('SIMPLEX bounds: exact minimax constants and attaining witnesses, not centroid', () => {
  for (const d of [2, 3]) {
    const m = S.create(d, 1), e = closed(d);
    near(S.bound(m), e, 2 * EPS, 'SIMPLEX closed lower bound');
    for (let vertex = 0; vertex <= d; vertex++) {
      const p = S.best(m, vertex);
      vector(p, m.base[vertex].map(x => -4 * e * x), 4 * EPS, 'optimal face-exterior witness');
      m.base.forEach((v, i) => near(distance(v, p) / m.edge, 1 + (i === vertex ? e : -e), 4 * EPS, 'attaining distances'));
      near(S.measure(m, p).maxError, e, 4 * EPS, 'displayed best posture');
    }
    const centerError = 1 - m.radius / m.edge;
    near(objective(m.base, [0, 0, 0, 0], m.edge), centerError, 2 * EPS, 'centroid, not optimum');
    assert(centerError > e + 0.09);
    assert(Math.min(...m.base.map(v => distance(v, [100, 0, 0, 0]))) > 90, 'max min distance is unbounded');
  }
});

test('SIMPLEX global certificate: convex squared-distance box excludes every smaller error', () => {
  for (const d of [2, 3]) {
    const n = d + 1, e = closed(d), m = S.create(d, 1), L2 = m.edge ** 2, R2 = m.radius ** 2;
    for (let k = 0; k <= n; k++) {
      const polynomial = t => (8 * k * (n - k) - n) * t * t - 2 * (2 * k - n) * t - (n + 1) / 2;
      near(S.cornerCertificate(d, e, k), polynomial(e), 0, 'independent corner polynomial');
      if (k === 1) near(polynomial(e), 0, 8 * EPS, 'first root');
      else assert(polynomial(e) < -0.3, 'all other corners strictly excluded at optimum');
      // 在 [0,e*] 上，导数线性；内点驻值若存在，也直接核对，非仅网格取样。
      const A = 8 * k * (n - k) - n, B = -2 * (2 * k - n), stationary = -B / (2 * A);
      if (stationary > 0 && stationary < e) assert(polynomial(stationary) < 0);
      assert(polynomial(0) < 0 && polynomial(e - 1e-10) < 0);
      const q = Array.from({ length: n }, (_, i) => L2 * (1 + (i < k ? e : -e)) ** 2);
      const mean = q.reduce((s, x) => s + x, 0) / n;
      const F = q.reduce((s, x) => s + (x - mean) ** 2, 0) - 2 * L2 * (mean - R2);
      near(n * F / (2 * L2 * L2), polynomial(e), 32 * EPS, 'squared-distance certificate normalization');
    }
    for (let trial = 0; trial < 1000; trial++) {
      const p = Array.from({ length: 4 }, (_, i) => i < d ? 4 * random() - 2 : 0);
      const q = m.base.map(v => distance(v, p) ** 2), mean = q.reduce((s, x) => s + x, 0) / n;
      const F = q.reduce((s, x) => s + (x - mean) ** 2, 0) - 2 * L2 * (mean - R2);
      near(F / (L2 * L2), 0, 96 * EPS, 'actual points lie on F=0');
    }
  }
});

test('SIMPLEX numerical search: 60000 random points per dimension plus independent local optimization', () => {
  for (const d of [2, 3]) {
    const m = S.create(d, 1), expected = closed(d), starts = [];
    let randomBest = Infinity, optimizedBest = Infinity;
    for (let i = 0; i < 60000; i++) {
      const range = i % 3 === 0 ? 20 : 4;
      const p = Array.from({ length: 4 }, (_, a) => a < d ? (2 * random() - 1) * range : 0);
      const f = objective(m.base, p, m.edge);
      assert(f >= expected - 4 * EPS, 'random search cannot break closed bound');
      randomBest = Math.min(randomBest, f);
      if (starts.length < 32 || f < starts[starts.length - 1].f) {
        starts.push({ p, f }); starts.sort((a, b) => a.f - b.f); starts.length = Math.min(starts.length, 32);
      }
      if (i < 16) {
        const result = optimize(m.base, p, m.edge, d);
        assert(result.f >= expected - 4 * EPS, 'local optimization cannot break bound');
        optimizedBest = Math.min(optimizedBest, result.f);
      }
    }
    starts.forEach(start => {
      const result = optimize(m.base, start.p, m.edge, d);
      assert(result.f >= expected - 4 * EPS, 'optimized random best cannot break bound');
      optimizedBest = Math.min(optimizedBest, result.f);
    });
    near(optimizedBest, expected, 1e-11, 'independent optimizer reaches closed bound');
    console.log('  d=' + d + ': random=' + randomBest + ', optimized=' + optimizedBest + ', closed=' + expected);
  }
});

test('SIMPLEX exact: both signs give every pair equal to machine precision', () => {
  for (const d of [2, 3]) for (const sign of [-1, 1]) {
    const m = S.create(d, 1), p = S.exact(m, sign);
    near(p[d], sign * Math.sqrt(d === 3 ? 5 : 2), 2 * EPS, 'SIMPLEX exact normal height');
    p.forEach((v, i) => { if (i !== d) assert.strictEqual(v, 0); });
    const evidence = S.measure(m, p);
    assert.strictEqual(evidence.rows.length, d === 3 ? 10 : 6);
    evidence.rows.forEach(r => near(r.distance / m.edge, 1, 2 * EPS, 'all exact edges'));
    assert(evidence.exact && evidence.success);
    const perturbed = p.slice(); perturbed[d] += 1e-10;
    assert(!S.measure(m, perturbed).exact, 'rounded near-match must not be labelled exact');
  }
});

test('SIMPLEX squared differences force the projection to the centroid', () => {
  const m = S.create(3, 1);
  for (let i = 0; i < 1000; i++) {
    const p = Array.from({ length: 4 }, () => 4 * random() - 2), q = m.base.map(v => distance(p, v) ** 2);
    vector(q.slice(1).map(v => v - q[0]), [4 * (p[1] + p[2]), 4 * (p[0] + p[2]), 4 * (p[0] + p[1])],
      64 * EPS, 'three independent squared difference equations');
    const a = (q[1] - q[0]) / 4, b = (q[2] - q[0]) / 4, c = (q[3] - q[0]) / 4;
    vector([(b + c - a) / 2, (a + c - b) / 2, (a + b - c) / 2], p.slice(0, 3), 16 * EPS, 'invert difference equations');
    vector(S.recoverProjection(m, p), p.slice(0, 3).concat([0]), 32 * EPS, 'frame reconstruction');
  }
  for (const d of [2, 3]) {
    const model = S.create(d, 1);
    for (const h of [-3.5, -Math.sqrt(5), 0, 0.7, 3.5]) {
      const p = [0, 0, 0, 0]; p[d] = h;
      vector(S.recoverProjection(model, p), [0, 0, 0, 0], 8 * EPS, 'equidistant normal line');
      model.base.forEach(v => near(distance(p, v) ** 2, model.radius ** 2 + h * h, 32 * EPS, 'Pythagoras'));
    }
  }
});

test('SIMPLEX transfer: random scales and SO(3) preserve normalized bound and normal solution', () => {
  for (const d of [2, 3]) for (let i = 0; i < 128; i++) {
    const size = 0.2 + 2 * random(), rot = d === 3 ? rotation3() : M4.rotation('xy', random() * 2 * Math.PI);
    const m = S.create(d, size, rot), expected = closed(d);
    near(S.bound(m), expected, 4 * EPS, 'scale invariant bound');
    for (let v = 0; v <= d; v++) near(objective(m.base, S.best(m, v), m.edge), expected, 8 * EPS, 'rotated minimizer');
    for (const sign of [-1, 1]) {
      const p = S.exact(m, sign);
      near(p[d] / size, sign * Math.sqrt(d === 3 ? 5 : 2), 4 * EPS, 'scale changes height, SO(3) does not');
      S.measure(m, p).rows.forEach(r => near(r.distance / m.edge, 1, 8 * EPS, 'rotated/scaled exact edge'));
    }
    const trial = Array.from({ length: 4 }, (_, a) => a < d ? size * (random() * 6 - 3) : 0);
    assert(objective(m.base, trial, m.edge) >= expected - 8 * EPS);
    vector(S.recoverProjection(m, trial), trial, 128 * EPS * size, 'rotated squared differences span base');
  }
});

test('SIMPLEX cell5 isometry: match scale then construct an orthogonal map and translation', () => {
  const target = Polytopes.cell5().verts, originalEdge = distance(target[0], target[1]);
  near(originalEdge, 2.2 * Math.sqrt(2), 4 * EPS, 'cell5 has its own display scale');
  for (let trial = 0; trial < 32; trial++) {
    // 选择相同边长再谈等距变换；不同边长之间只有相似，不是等距。
    const m = S.create(3, originalEdge / Math.sqrt(8), rotation3());
    for (const sign of [-1, 1]) {
      const source = m.base.concat([S.exact(m, sign)]);
      const center = ps => [0, 1, 2, 3].map(a => ps.reduce((sum, p) => sum + p[a], 0) / 5);
      const ca = center(source), cb = center(target);
      const a = source.map(p => p.map((x, i) => x - ca[i])), b = target.map(p => p.map((x, i) => x - cb[i]));
      const Q = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) =>
        2 / (originalEdge * originalEdge) * a.reduce((sum, p, i) => sum + b[i][r] * p[c], 0)));
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        near(Q.reduce((sum, row) => sum + row[r] * row[c], 0), +(r === c), 16 * EPS, 'isometry Q^T Q=I');
      }
      source.forEach((p, i) => {
        const mapped = Q.map((row, r) => cb[r] + row.reduce((sum, x, c) => sum + x * (p[c] - ca[c]), 0));
        vector(mapped, target[i], 24 * EPS, 'all five labelled vertices map by same isometry');
        for (let j = i + 1; j < 5; j++) {
          near(distance(p, source[j]), originalEdge, 16 * EPS, 'source edge');
          near(distance(target[i], target[j]), originalEdge, 16 * EPS, 'cell5 edge');
        }
      });
    }
  }
});

function view(width = 900, height = 890, dpr = 1) {
  global.document = { documentElement: {} };
  global.getComputedStyle = () => ({ getPropertyValue: () => '#abcdef' });
  const ctx = new Proxy({}, { get: (o, key) => key in o ? o[key] : () => {} });
  return new SimplexView({ width: width * dpr, height: height * dpr,
    getBoundingClientRect: () => ({ width, height }), getContext: () => ctx });
}
test('SIMPLEX view: locked dimensions, best/centroid contrast and honest transfer checks', () => {
  const v = view();
  assert.throws(() => v.setCoordinate(3, 1), /尚未开放/);
  v.best(); near(v.snapshot().evidence.maxError, closed(3), 4 * EPS, 'best button target');
  v.center(); assert(v.snapshot().evidence.maxError > 0.38);
  for (const kind of ['size', 'rotation', 'low']) {
    v.startChallenge(kind);
    assert(!v.unlocked && !v.assisted);
    const prediction = kind === 'rotation' ? 'same' : 'pythagoras';
    assert(!v.checkTransfer(prediction), 'prediction alone is insufficient');
    v.reveal(-1); assert(!v.checkTransfer(prediction), 'reveal cannot earn completion');
    v.startChallenge(kind); v.unlock(true);
    const p = S.exact(v.model(), -1);
    p.forEach((x, a) => { if (a <= v.dimension) v.setCoordinate(a, x); });
    assert(!v.checkTransfer('fixed'), 'memorized sqrt5 is insufficient');
    assert(v.checkTransfer(prediction), 'actual placement and structural prediction');
    assert(v.completed[kind]);
    v.unlock(false); near(v.p[v.dimension], 0, 0, 'relock clears normal coordinate');
  }
  assert.throws(() => v.setCoordinate(3, 1), /超界/);
  const lower = v.model(); assert(lower.dimension === 2 && lower.base.every(p => p[2] === 0 && p[3] === 0));
});
test('SIMPLEX projection: camera cannot change evidence; both signs share an orthographic shadow', () => {
  const v = view(); v.reveal(1); v.draw();
  v.snapshot().evidence.rows.forEach(row => near(row.distance, Math.sqrt(8), 4 * EPS,
    'SIMPLEX true screen-independent ledger'));
  const before = JSON.stringify(v.snapshot()), p = v.p.slice(), r = v.rects[0];
  vector(v.project(p, r), v.project([0, 0, 0, -p[3]], r), 0, 'same xyz shadow');
  v.mode = 'perspective'; v.camYaw = -1.2; v.camPitch = 0.7; v.draw();
  assert.strictEqual(JSON.stringify(v.snapshot()), before, 'camera-independent metric evidence');
  for (const width of [320, 390, 1280]) for (const dpr of [1, 3]) {
    const current = view(width, width < 680 ? 1150 : 890, dpr); current.draw();
    assert(current.rects[0].h >= 300);
    current.rects.forEach(rect => assert(rect.x >= 0 && rect.x + rect.w <= width && rect.h > 0));
  }
});
test('SIMPLEX validation rejects invalid geometry instead of a success-shaped fallback', () => {
  assert.throws(() => S.create(4, 1)); assert.throws(() => S.create(3, 0)); assert.throws(() => S.create(3, NaN));
  assert.throws(() => S.create(3, 1, M4.rotation('xw', 0.2)));
  assert.throws(() => S.create(2, 1, M4.rotation('xz', 0.2)));
  const reflection = M4.ident(); reflection[0] = -1;
  assert.throws(() => S.create(3, 1, reflection));
  assert.throws(() => S.measure(S.create(3, 1), [0, 0, NaN, 0]));
  assert.throws(() => S.exact(S.create(3, 1), 0));
  assert.throws(() => S.best(S.create(3, 1), 4));
  assert.throws(() => S.cornerCertificate(3, 0.2, 5));
});

if (!passed && !failed) throw new Error('No simplex tests selected');
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

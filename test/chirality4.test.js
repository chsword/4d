'use strict';

global.window = global;
require('../js/m4.js');
require('../js/chirality4.js');
require('../js/view-chirality.js');

var C = Chirality4, passed = 0, failed = 0, seed = 0x4d2026, EPS = Number.EPSILON;
function assert(ok, message) { if (!ok) throw new Error(message); }
function near(a, b, eps, message) {
  assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps,
    message + ': ' + a + ' vs ' + b + ' (limit ' + eps + ')');
}
function test(name, run) {
  if (process.argv[2] && name.indexOf(process.argv[2]) < 0) return;
  seed = 0x4d2026;
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function distance(a, b) { return Math.hypot.apply(null, a.map(function (x, i) { return x - b[i]; })); }
// 余子式独立展开，不拿被测模块的行列式验证它自己。
function determinant(a, n) {
  if (n === 1) return a[0];
  var sum = 0;
  for (var c = 0; c < n; c++) {
    var minor = [];
    for (var r = 1; r < n; r++) for (var k = 0; k < n; k++) if (k !== c) minor.push(a[r * n + k]);
    sum += (c % 2 ? -1 : 1) * a[c] * determinant(minor, n - 1);
  }
  return sum;
}
function volume(ps, axes) {
  var b = [];
  axes.forEach(function (a) { for (var i = 1; i < 4; i++) b.push(ps[i][a] - ps[0][a]); });
  return determinant(b, 3) / 6;
}
function gramVolume(ps) {
  var gram = [];
  for (var i = 1; i < 4; i++) for (var j = 1; j < 4; j++) {
    var sum = 0;
    for (var k = 0; k < 4; k++) sum += (ps[i][k] - ps[0][k]) * (ps[j][k] - ps[0][k]);
    gram.push(sum);
  }
  return Math.sqrt(determinant(gram, 3)) / 6;
}
var all = C.vertices.concat(C.points);
var angles = Array.from({ length: 2049 }, function (_, i) { return Math.PI * i / 2048; });
for (var a = 0; a < 128; a++) angles.push(Math.PI * random());

test('fixed identities, volumetric hand, immutable source and independent mirror target', function () {
  assert(C.points.length === 10 && C.vertices.length === 80, 'all markers and solid-box vertices present');
  assert(new Set(C.markers.map(function (m) { return m.id; })).size === 10, 'unique material IDs');
  assert(C.faces.length === 60 && C.edges.length === 120, 'ten solid boxes');
  assert(C.points[0][2] < -0.2 && C.points[1][2] > 0.2, 'distinct palm and back');
  near(volume(C.witness(C.points), [0, 1, 2]), 0.048, 2 * EPS * 0.048, 'nonzero witness volume');
  C.points.forEach(function (p, i) {
    near(distance(C.target[i], [-p[0], p[1], p[2], 0]), 0, 0, 'pointwise target');
  });
  all.forEach(function (p) { assert(Object.isFrozen(p), 'material point frozen'); });
  var rejected = false;
  try { C.points[0][0] = 99; } catch (e) { if (!(e instanceof TypeError)) throw e; rejected = true; }
  assert(rejected, 'source cannot become the target through mutation');
});

test('rigidity: every pair of all 90 material points across the full path', function () {
  var pairs = [], maxAbsolute = 0, maxRelative = 0;
  for (var i = 0; i < all.length; i++) for (var j = i + 1; j < all.length; j++) {
    pairs.push([i, j, distance(all[i], all[j])]);
  }
  angles.forEach(function (theta) {
    var ps = C.transform(all, C.rotation4(theta));
    pairs.forEach(function (pair) {
      var error = Math.abs(distance(ps[pair[0]], ps[pair[1]]) - pair[2]);
      maxAbsolute = Math.max(maxAbsolute, error);
      if (pair[2]) maxRelative = Math.max(maxRelative, error / pair[2]);
    });
  });
  near(maxAbsolute, 0, 8 * EPS, 'maximum absolute pair-distance drift');
  near(maxRelative, 0, 16 * EPS, 'maximum relative pair-distance drift');
  console.log('  ' + pairs.length + ' pairs × ' + angles.length + ' angles; max |Δd|=' + maxAbsolute
    + ', relative=' + maxRelative);
});

test('SO(4): orthogonality and det(R4)=+1, including the normal direction', function () {
  angles.forEach(function (theta) {
    var R = C.rotation4(theta);
    near(determinant(R, 4), 1, 2 * EPS, 'independent det4');
    near(C.det4(R), determinant(R, 4), 2 * EPS, 'displayed det4');
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      var dot = 0;
      for (var k = 0; k < 4; k++) dot += R[k * 4 + i] * R[k * 4 + j];
      near(dot, i === j ? 1 : 0, 2 * EPS, 'R transpose R');
    }
  });
  var end = C.rotation4(Math.PI), diag = [-1, 1, 1, -1];
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
    near(end[r * 4 + c], r === c ? diag[r] : 0, EPS, 'endpoint matrix, including w');
  }
  near(determinant([-1, 0, 0, 0, 1, 0, 0, 0, 1], 3), -1, 0, 'restriction to H reverses orientation');
});

test('endpoint equals the x mirror pointwise and returns to w=0 at machine precision', function () {
  C.transform(all, C.rotation4(Math.PI)).forEach(function (p, i) {
    near(p[0], -all[i][0], 0, 'x exactly negated');
    near(p[1], all[i][1], 0, 'y unchanged');
    near(p[2], all[i][2], 0, 'z unchanged');
    near(p[3], 0, EPS * Math.abs(all[i][0]), 'w is only the sin(pi) floating-point residual');
  });
  near(C.mismatch(C.transform(C.points, C.rotation4(Math.PI))), 0, EPS, '4D endpoint mismatch');
});

test('oriented xyz volume follows V0 cos(theta) and reverses its sign', function () {
  var initial = volume(C.witness(C.points), [0, 1, 2]);
  angles.forEach(function (theta) {
    var tetra = C.witness(C.transform(C.points, C.rotation4(theta)));
    var actual = volume(tetra, [0, 1, 2]);
    near(actual, initial * Math.cos(theta), 6 * EPS * initial, 'analytic signed volume');
    near(C.signedVolume(tetra), actual, 4 * EPS * initial, 'display uses actual geometry');
  });
  near(C.signedVolume(C.witness(C.transform(C.points, C.rotation4(Math.PI)))), -initial, 0, 'chirality reversed');
});

test('Gram material volume stays constant, with an independent minor-squares cross-check', function () {
  var initial = gramVolume(C.witness(C.points)), maxRelative = 0;
  angles.forEach(function (theta) {
    var tetra = C.witness(C.transform(C.points, C.rotation4(theta)));
    var actual = gramVolume(tetra), minors = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
    var viaMinors = Math.hypot.apply(null, minors.map(function (axes) { return volume(tetra, axes); }));
    near(actual, viaMinors, 16 * EPS * initial, 'Cauchy-Binet identity');
    near(C.materialVolume(tetra), actual, 8 * EPS * initial, 'live Gram volume');
    maxRelative = Math.max(maxRelative, Math.abs(actual / initial - 1));
  });
  near(maxRelative, 0, 16 * EPS, 'relative material-volume drift');
  console.log('  max relative Gram-volume drift=' + maxRelative);
});

test('90 degrees loses only the xyz projection: yzw and xw keep the missing extent', function () {
  var ps = C.transform(C.points, C.rotation4(Math.PI / 2)), tetra = C.witness(ps);
  near(volume(tetra, [0, 1, 2]), 0, EPS * 0.048, 'collapsed xyz volume');
  near(Math.abs(volume(tetra, [3, 1, 2])), 0.048, 2 * EPS * 0.048, 'full material volume in yzw');
  near(ps[9][0] - ps[8][0], 0, EPS * C.referenceLength, 'AB has no projected x extent');
  near(ps[9][3] - ps[8][3], C.referenceLength, 0, 'AB extent is now in w');
  assert(C.mismatch(ps) > 0.5, 'overlapping projection is not falsely scored as success');
});

function randomRotation() {
  // 均匀采样单位四元数；不能用均匀欧拉角冒充 SO(3) 的均匀采样。
  var u = random(), v = 2 * Math.PI * random(), t = 2 * Math.PI * random();
  var x = Math.sqrt(1 - u) * Math.sin(v), y = Math.sqrt(1 - u) * Math.cos(v);
  var z = Math.sqrt(u) * Math.sin(t), w = Math.sqrt(u) * Math.cos(t);
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
function apply3(R, p) {
  return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2],
    R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2], 0];
}
function score(R, shift) {
  var sum = 0;
  C.points.forEach(function (p, i) {
    var q = apply3(R, p);
    for (var j = 0; j < 3; j++) sum += Math.pow(q[j] + (shift ? shift[j] : 0) - C.target[i][j], 2);
  });
  return Math.sqrt(sum / C.points.length) / C.referenceLength;
}
function turn(R, plane, angle) {
  var out = R.slice(), i = plane[0], j = plane[1], c = Math.cos(angle), s = Math.sin(angle);
  for (var k = 0; k < 3; k++) {
    out[3 * i + k] = c * R[3 * i + k] - s * R[3 * j + k];
    out[3 * j + k] = s * R[3 * i + k] + c * R[3 * j + k];
  }
  return out;
}
function optimize(R) {
  var best = score(R), step = 0.25, rounds = 0, planes = [[0, 1], [0, 2], [1, 2]];
  while (step > 1e-9 && rounds++ < 3000) {
    var improved = false;
    planes.forEach(function (plane) {
      [-1, 1].forEach(function (sign) {
        var next = turn(R, plane, sign * step), value = score(next);
        if (value < best) { R = next; best = value; improved = true; }
      });
    });
    if (!improved) step /= 2;
  }
  assert(rounds < 3000, 'local optimization converged');
  near(determinant(R, 3), 1, 64 * EPS, 'optimizer remains in SO(3)');
  return best;
}

test('SO(3) impossibility: certified positive lower bound, 60000 rotations and eight local fits', function () {
  var covariance = Array(9).fill(0);
  C.points.forEach(function (p) {
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) covariance[i * 3 + j] += p[i] * p[j] / C.points.length;
  });
  var lambda = 2 * 0.24 * 0.24 / 10, L = 1.2, bound = 2 * Math.sqrt(lambda) / L;
  near(covariance[2], 0, 0, 'xz covariance');
  near(covariance[5], 0, 0, 'yz covariance');
  near(covariance[8], lambda, EPS * lambda, 'z eigenvalue');
  assert(covariance[0] > lambda && (covariance[0] - lambda) * (covariance[4] - lambda)
    - covariance[1] * covariance[3] > 0.1, 'C-lambda I is positive semidefinite: certified global lower bound');
  near(C.lowerBound, bound, EPS, 'displayed lower bound independently certified');
  var best = [];
  for (var i = 0; i < 60000; i++) {
    var R = randomRotation(), value = score(R);
    near(determinant(R, 3), 1, 12 * EPS, 'random SO(3) rotation');
    assert(value >= bound - 4 * EPS, 'no sampled rotation violates the certified bound');
    if (best.length < 8 || value < best[7].value) {
      best.push({ R: R, value: value }); best.sort(function (a, b) { return a.value - b.value; }); best.length = Math.min(8, best.length);
    }
    if (i < 100) {
      near(C.mismatch(C.points.map(function (p) { return apply3(R, p); })), value, 4 * EPS, 'UI mismatch matches independent score');
      near(volume(C.points.map(function (p) { return apply3(R, p); }).filter(function (_, k) {
        return C.witnessIds.indexOf(k) >= 0;
      }), [0, 1, 2]), volume(C.points.filter(function (_, k) {
        return C.witnessIds.indexOf(k) >= 0;
      }), [0, 1, 2]), 12 * EPS * 0.048, 'SO(3) keeps signed volume');
    }
  }
  var optimized = best.map(function (item) { return optimize(item.R); }), minimum = Math.min.apply(null, optimized);
  assert(minimum > 0.17, 'minimum stays far from zero');
  optimized.forEach(function (value) { near(value, bound, 64 * EPS, 'local fit reaches, but cannot beat, exact lower bound'); });
  near(C.mismatch(C.transform(C.points, C.rotation3(0, Math.PI, 0))), bound, EPS, 'best-pose button attains bound');
  console.log('  certified e >= ' + bound + '; sampled min=' + best[0].value + '; optimized min=' + minimum);
  console.log('  4D endpoint e=' + C.mismatch(C.transform(C.points, C.rotation4(Math.PI))));
});

test('centroid alignment already optimizes translation; full 4D mismatch follows analytic path', function () {
  var mean = C.points.reduce(function (s, p) { return s.map(function (v, i) { return v + p[i] / C.points.length; }); }, [0, 0, 0, 0]);
  near(distance(mean, [0, 0, 0, 0]), 0, EPS, 'centered material markers');
  for (var i = 0; i < 100; i++) {
    var R = randomRotation(), shift = [random(), random(), random()];
    near(Math.pow(score(R, shift), 2), Math.pow(score(R), 2) + shift.reduce(function (s, v) { return s + v * v; }, 0) / 1.44,
      16 * EPS, 'nonzero translation only adds squared error');
  }
  angles.forEach(function (theta) {
    var exact = 2 * Math.sqrt(C.covariance[0]) * Math.cos(theta / 2) / C.referenceLength;
    near(C.mismatch(C.transform(C.points, C.rotation4(theta))), exact, 4 * EPS, 'full 4D analytic mismatch');
  });
});

test('real view uses the same geometry; camera/labels/target visibility cannot change the score', function () {
  var v = Object.create(ChiralityView.prototype);
  Object.assign(v, { angles: { xy: 0.7, xz: -1.2, yz: 2.4 }, theta: Math.PI / 2, camera: 'front',
    playing: false, selected: 0, showTarget: true });
  var before = v.snapshot();
  v.camera = 'back'; v.selected = 7; v.showTarget = false;
  var after = v.snapshot();
  near(after.e3, before.e3, 0, 'observer cannot improve 3D mismatch');
  near(after.e4, before.e4, 0, 'observer cannot improve 4D mismatch');
  near(after.volume, C.materialVolume(C.witness(after.p4)), 0, 'live volume measured from live coordinates');
  near(after.det, determinant(after.r4, 4), 2 * EPS, 'live determinant measured from live matrix');
  v.theta = 0; v.playing = true;
  for (var i = 0; i < 1000; i++) v.step(0.016);
  near(v.theta, Math.PI, 0, 'playback ends without wrapping into another hand');
  assert(!v.playing, 'playback stops at endpoint');
  near(v.snapshot().e4, 0, EPS, 'actual view reaches zero mismatch');
  v.theta = Math.PI / 2; v.step(10); near(v.theta, Math.PI / 2, 0, 'paused 90-degree inspection is stable');
});

test('direct canvas controls keep 3D rotations separate from the 4D scrubber', function () {
  var listeners = {}, v = Object.create(ChiralityView.prototype), previous = global.addEventListener;
  Object.assign(v, { angles: { xy: 0, xz: 0, yz: 0 }, theta: 0, playing: false,
    rects: [{ x: 12, y: 116, w: 300, h: 300 }, { x: 324, y: 116, w: 300, h: 300 }],
    canvas: {
      addEventListener: function (name, fn) { listeners[name] = fn; },
      setPointerCapture: function () {},
      getBoundingClientRect: function () { return { left: 10, top: 20 }; }
    } });
  global.addEventListener = function () {};
  try { v._bindPointer(); } finally { global.addEventListener = previous; }
  function pointer(name, x, y) { listeners[name]({ button: 0, pointerId: 1, clientX: x + 10, clientY: y + 20 }); }
  pointer('pointerdown', 100, 200); pointer('pointermove', 140, 260); pointer('pointerup', 140, 260);
  near(v.angles.xz, 0.4, EPS, 'horizontal drag rotates only the 3D pose');
  near(v.angles.yz, 0.6, EPS, 'vertical mouse drag rotates only the 3D pose');
  near(v.theta, 0, 0, '3D drag does not advance 4D path');
  var score3 = v.snapshot().e3;
  v.playing = true;
  pointer('pointerdown', 474, 200);
  near(v.theta, Math.PI / 2, 0, 'middle of scrubber is exactly 90 degrees');
  assert(!v.playing, 'scrubbing pauses automatic playback');
  pointer('pointermove', 700, 200);
  near(v.theta, Math.PI, 0, 'scrubber ends exactly at pi even beyond its edge');
  near(v.snapshot().e3, score3, 0, '4D scrubber cannot change comparison pose');
  v.clearInput(); pointer('pointermove', 400, 200);
  near(v.theta, Math.PI, 0, 'tab change cancels captured input');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;

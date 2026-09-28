'use strict';
global.window = global;
require('../js/m4.js');
require('../js/rings4.js');
require('../js/view-rings.js');

var R = Rings4, EPS = Number.EPSILON, TAU = 2 * Math.PI, passed = 0, failed = 0;
function assert(ok, message) { if (!ok) throw new Error(message); }
function near(a, b, eps, message) {
  assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps,
    message + ': ' + a + ' vs ' + b + ' (limit ' + eps + ')');
}
function test(name, run) {
  if (process.argv[2] && name.indexOf(process.argv[2]) < 0) return;
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
}
function d3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

test('fixed material identities, radius, source immutability and A02 poses', function () {
  assert(R.count === 96 && R.a.length === 96 && R.b.length === 96 && R.edges.length === 96, 'complete rings');
  near(R.rho, 0.1, 0, 'fixed tube radius');
  [R.a, R.b].forEach(function (ps) {
    assert(Object.isFrozen(ps) && ps.every(Object.isFrozen), 'immutable material coordinates');
  });
  for (var i = 0; i < 96; i++) {
    var u = TAU * i / 96;
    near(distance(R.a[i], [Math.cos(u), Math.sin(u), 0, 0]), 0, 0, 'A source');
    near(distance(R.b[i], [1 + Math.cos(u), 0, Math.sin(u), 0]), 0, 0, 'B source');
  }
  [[0, 0, 0], [1, 0, 1], [2, 3, 1], [3, 3, 0]].forEach(function (x) {
    var p = R.path(x[0]); near(p.x, x[1], 0, 'path x'); near(p.w, x[2], 0, 'path w');
  });
});

test('F11 returned certificate matches every segment and never exceeds independent distance', function () {
  var times = Array.from({ length: 601 }, function (_, i) { return i / 200; });
  [1, 2].forEach(function (t) { times.push(t - 1e-9, t, t + 1e-9); });
  [false, true].forEach(function (omit) {
    times.forEach(function (t) {
      var p = R.path(t, omit), w = t < 1 ? t : t < 2 ? 1 : 3 - t;
      var x = omit ? 0 : 3 * Math.max(0, Math.min(1, t - 1));
      var expected = omit || t < 1 ? Math.hypot(1, w) : t < 2 ? 1 : 2;
      near(p.bound, expected, 2 * EPS, 'F11 returned analytic certificate');
      assert(p.bound <= Math.hypot(x - 1, w) + 4 * EPS, 'F11 bound cannot exceed true nearest-point distance');
    });
  });
});

test('rigidity: all 4560 pairs per ring at 1537 times, including omitted translation', function () {
  var pairs = [], maxAbsolute = 0, maxRelative = 0;
  for (var i = 0; i < 96; i++) for (var j = i + 1; j < 96; j++) {
    pairs.push([i, j, distance(R.a[i], R.a[j]), distance(R.b[i], R.b[j])]);
  }
  [false, true].forEach(function (omit) {
    for (var k = 0; k <= 1536; k++) {
      var ps = R.rings(R.path(k / 512, omit));
      pairs.forEach(function (pair) {
        [ps.a, ps.b].forEach(function (ring, n) {
          var ref = pair[n + 2], error = Math.abs(distance(ring[pair[0]], ring[pair[1]]) - ref);
          maxAbsolute = Math.max(maxAbsolute, error); maxRelative = Math.max(maxRelative, error / ref);
        });
      });
    }
  });
  near(maxAbsolute, 0, 8 * EPS, 'absolute pair-distance drift');
  near(maxRelative, 0, 64 * EPS, 'relative pair-distance drift, including short chords');
  console.log('  max |Δd|=' + maxAbsolute + ', relative=' + maxRelative);
});

test('closure: cyclic edges, all chords, seam and continuous joins at every path segment', function () {
  for (var k = 0; k <= 600; k++) {
    [false, true].forEach(function (omit) {
      var p = R.path(k / 200, omit), ps = R.rings(p);
      [ps.a, ps.b].forEach(function (ring) {
        var degree = Array(96).fill(0);
        R.edges.forEach(function (e, i) {
          assert(e[0] === i && e[1] === (i + 1) % 96, 'fixed cyclic edge identities');
          degree[e[0]]++; degree[e[1]]++;
          // 浮点参数的相邻角差并非逐位相同；使用实际角差验证弦长，容差不放宽。
          var angle = e[1] ? R.angles[e[1]] - R.angles[i] : TAU - R.angles[i];
          var chord = 2 * Math.sin(angle / 2);
          near(distance(ring[e[0]], ring[e[1]]), chord, 6 * EPS, 'no broken or stretched edge, including seam');
        });
        assert(degree.every(function (d) { return d === 2; }), 'one closed loop');
      });
      near(distance(R.pointA(0), R.pointA(TAU)), 0, 2 * EPS, 'analytic A seam');
      near(distance(R.pointB(0, p), R.pointB(TAU, p)), 0, 2 * EPS, 'analytic B seam');
    });
  }
  [1, 2].forEach(function (t) {
    var h = 1e-8, left = R.rings(R.path(t - h)), mid = R.rings(R.path(t)), right = R.rings(R.path(t + h));
    for (var i = 0; i < 96; i++) {
      assert(distance(left.b[i], mid.b[i]) <= 3 * h + 8 * EPS, 'continuous segment entry');
      assert(distance(right.b[i], mid.b[i]) <= 3 * h + 8 * EPS, 'continuous segment exit');
    }
  });
});

[1, 2, 3].forEach(function (stage) {
  test('continuous safety stage ' + stage + ': dense (u,v,time) versus its A02 analytic bound', function () {
    var leastGap = Infinity, count = 0, tightError = 0;
    // 三段各 257×256×256；额外偏移网格避免只测对称轴。
    [0, 0.371].forEach(function (phase) {
      var n = phase ? 128 : 256, steps = phase ? 64 : 256;
      var as = Array.from({ length: n }, function (_, i) { return R.pointA(TAU * (i + phase) / n); });
      for (var k = 0; k <= steps; k++) {
        var f = k / steps, t = stage - 1 + f, p = R.path(t);
        var w = stage === 1 ? f : stage === 2 ? 1 : 1 - f;
        var expectedX = stage === 1 ? 0 : stage === 2 ? 3 * f : 3;
        near(p.x, expectedX, 0, 'stage x'); near(p.w, w, 0, 'stage w');
        var bound = stage === 1 ? Math.sqrt(1 + w * w) : stage === 2 ? 1 : 2;
        var bs = Array.from({ length: n }, function (_, i) { return R.pointB(TAU * (i + phase) / n, p); });
        var min2 = Infinity;
        for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
          var a = as[i], b = bs[j], x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2], dw = a[3] - b[3];
          var d2 = x * x + y * y + z * z + dw * dw;
          min2 = Math.min(min2, d2); count++;
        }
        assert(min2 >= bound * bound - 8 * EPS, 'no sample below analytic bound');
        assert(min2 > 0.04, 'strict tube separation');
        var min = Math.sqrt(min2), actual = R.minimum(p), exact = Math.hypot(expectedX - 1, w);
        near(actual.distance, exact, 4 * EPS, 'displayed current minimum independent formula');
        near(distance(actual.a, actual.b), exact, 4 * EPS, 'witness attains the true minimum');
        if (!phase) { near(min, exact, 4 * EPS, 'dense grid contains an attaining witness'); tightError = Math.max(tightError, Math.abs(min - exact)); }
        else assert(min >= exact - 4 * EPS, 'off-axis samples cannot beat the minimum');
        leastGap = Math.min(leastGap, min - 0.2);
      }
    });
    console.log('  ' + count + ' point/time triples; min gap=' + leastGap + '; min-distance error=' + tightError);
  });
});

test('capsule distance: interiors, endpoints, parallel, reversed and zero-length segments in 4D', function () {
  var cases = [
    [[-1, 0, 0, 0], [1, 0, 0, 0], [0, -1, 0, 1], [0, 1, 0, 1], 1],
    [[0, 0, 0, 0], [1, 0, 0, 0], [0, 2, 0, 0], [1, 2, 0, 0], 2],
    [[0, 0, 0, 0], [1, 0, 0, 0], [3, 0, 0, 0], [2, 0, 0, 0], 1],
    [[0, 0, 0, 0], [0, 0, 0, 0], [-1, 0, 0, 2], [1, 0, 0, 2], 2],
    [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 3], [0, 0, 0, 3], 3],
    [[0, 0, 0, 0], [1, 0, 0, 0], [0.5, -1, 0, 0], [0.5, 1, 0, 0], 0],
    [[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [1, 1 + 1e-9, 0, 0], 1]
  ];
  cases.forEach(function (c) {
    var q = R.segmentDistance(c[0], c[1], c[2], c[3]);
    near(q.distance, c[4], 8 * EPS, 'segment distance');
    near(distance(q.a, q.b), c[4], 8 * EPS, 'actual witnesses');
    near(R.segmentDistance(c[2], c[3], c[0], c[1]).distance, c[4], 8 * EPS, 'swap symmetry');
    assert(q.s >= 0 && q.s <= 1 && q.t >= 0 && q.t <= 1, 'points on segments');
  });
});

test('closed capsule chains independently enclose exact circle distance with explicit sagitta error', function () {
  var error = 2 * (1 - Math.cos(Math.PI / 96)), maxError = 0;
  for (var k = 0; k <= 96; k++) {
    var p = R.path(3 * k / 96), q = R.capsuleDistance(R.rings(p)), exact = Math.hypot(p.x - 1, p.w);
    assert(q.curveLower <= exact + 8 * EPS && q.curveUpper >= exact - 8 * EPS, 'certified circle interval');
    near(q.curveUpper - q.distance, error, 2 * EPS, 'upper sagitta');
    near(q.distance - q.curveLower, error, 2 * EPS, 'lower sagitta');
    near(distance(q.a, q.b), q.distance, 8 * EPS, 'capsule witness coordinates');
    assert(q.gap > 0.79, 'capsules also stay disjoint');
    maxError = Math.max(maxError, Math.abs(q.distance - exact));
  }
  console.log('  max polygon/circle distance error=' + maxError + '; certified <= ' + error);
});

// 直接计算 Gauss 双积分，不调用路径模块的 minimum/bound，也不把整数硬编码进算法。
// 周期梯形求积使用解析圆切向量；Kahan 累加减少双重求和的舍入误差。绝不 round 后断言。
function gauss(p, n, reverse, rigidTransform) {
  var as = [], bs = [], da = [], db = [], du = TAU / n;
  function transform(v, tangent) { return rigidTransform ? rigidTransform(v, tangent) : v; }
  for (var i = 0; i < n; i++) {
    var u = (i + 0.217) * du, v = (i + 0.613) * du * (reverse ? -1 : 1);
    as.push(transform(R.pointA(u), false)); bs.push(transform(R.pointB(v, p), false));
    da.push(transform([-Math.sin(u), Math.cos(u), 0, 0], true));
    var sign = reverse ? -1 : 1;
    db.push(transform([-sign * Math.sin(v), 0, sign * Math.cos(v), 0], true));
  }
  var sum = 0, correction = 0;
  for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) {
    var delta = as[a].slice(0, 3).map(function (v, k) { return v - bs[b][k]; });
    var d = Math.hypot.apply(null, delta);
    assert(d > 1e-8, 'Gauss integral undefined on intersecting xyz curves');
    var term = dot(delta, cross(da[a], db[b])) / (d * d * d) - correction;
    var next = sum + term; correction = (next - sum) - term; sum = next;
  }
  return sum * du * du / (4 * Math.PI);
}

test('Gauss linking integral: initial -1, final 0, convergence, orientation and rigid-frame invariance', function () {
  [64, 128, 256].forEach(function (n) {
    var initial = gauss(R.path(0), n), final = gauss(R.path(3), n);
    near(initial, -1, 64 * EPS, 'initial unrounded linking number');
    near(final, 0, 64 * EPS, 'final unrounded linking number');
    console.log('  ' + n + '² terms: Lk(initial)=' + initial + ', Lk(final)=' + final);
  });
  near(gauss(R.path(0), 128, true), 1, 64 * EPS, 'orientation reversal changes sign');
  function transform(p, tangent) {
    var c = Math.cos(0.7), s = Math.sin(0.7), shift = tangent ? 0 : 1;
    return [c * p[0] - s * p[2] + 2 * shift, p[1] - 3 * shift, s * p[0] + c * p[2] + shift, 0];
  }
  near(gauss(R.path(0), 128, false, transform), -1, 64 * EPS, 'translated and rotated frame');
  near(gauss(R.path(3), 128, false, transform), 0, 64 * EPS, 'unlinked in same frame');
});

test('omitting the second translation returns every material point and linking number to the original', function () {
  var end = R.rings(R.path(3, true));
  end.a.forEach(function (p, i) { near(distance(p, R.a[i]), 0, 0, 'A returns exactly'); });
  end.b.forEach(function (p, i) { near(distance(p, R.b[i]), 0, 0, 'B returns exactly'); });
  for (var k = 0; k <= 300; k++) {
    var p = R.path(k / 100, true);
    near(p.x, 0, 0, 'no hidden translation');
    near(R.minimum(p).distance, Math.hypot(1, p.w), 4 * EPS, 'safe but still linked');
    near(p.bound, Math.hypot(1, p.w), 0, 'failure path must not inherit third-stage bound 2');
  }
  near(gauss(R.path(3, true), 256), -1, 64 * EPS, 'linking number stays -1 after up/down');
});

test('stage two really intersects in xyz, while 4D distance stays 1 and tube gap is 0.8', function () {
  var p = R.path(R.crossingTime), q = R.minimum(p), a = R.pointA(0), b = R.pointB(Math.PI, p);
  assert(p.stage === 2, 'intersection occurs during translation');
  near(d3(a, b), 0, 2 * EPS, 'same xyz coordinates to machine precision');
  near(a[3], 0, 0, 'A w'); near(b[3], 1, 0, 'B w');
  near(q.distance, 1, 0, 'full 4D centerline distance');
  near(q.distance - 2 * R.rho, 0.8, 0, 'positive material surface gap');
  assert(q.distance >= p.bound, 'analytic continuous lower bound at projected intersection');
  [-1e-4, 1e-4].forEach(function (dt) {
    var adjacent = R.minimum(R.path(R.crossingTime + dt));
    assert(adjacent.projected > 0.000299999999 && adjacent.distance > 1, 'isolated true xyz crossing, not permanent overlap');
  });
});

test('3D contact: first touching at x=0.8, huge requests cannot tunnel, and pulling back remains possible', function () {
  for (var k = 0; k <= 3000; k++) {
    var requested = k / 1000, p = R.pull3(requested), q = R.minimum(p);
    near(p.x, Math.min(requested, 0.8), 0, 'first-contact limiter');
    near(p.w, 0, 0, '3D never gets hidden w');
    assert(q.distance >= 0.2 - EPS, 'no penetration');
    assert(p.contact === (requested >= 0.8), 'contact indicator');
  }
  var p = R.pull3(3), q = R.minimum(p);
  near(q.distance, 0.2, EPS, 'first contact even when requested endpoint is free');
  near(distance(q.a, [1, 0, 0, 0]), 0, 0, 'A contact centerline point');
  near(distance(q.b, [0.8, 0, 0, 0]), 0, EPS, 'B contact centerline point');
  near(gauss(p, 256), -1, 1e-12, 'contact of tubes does not unlink centerlines');
  near(R.pull3(0).x, 0, 0, 'pullback is not latched');
  near(R.minimum({ x: 1, w: 0 }).distance, 0, EPS, 'ignoring tubes would force a centerline intersection');
});

test('3D impossibility certificate: signed spanning-disk intersection, not an exhausted finite search', function () {
  // 对已知圆的 z(v)=sin(v)，只有 0、π 两个过平面点；圆盘法向 +z。
  // 数值核对下面的精确证书，普遍不可能性来自 README 中 Gauss 映射度数的不变性。
  function diskIntersections(p) {
    return [0, Math.PI].reduce(function (sum, v) {
      var b = R.pointB(v, p), radial = b[0] * b[0] + b[1] * b[1];
      assert(Math.abs(radial - 1) > 0.1, 'no crossing on disk boundary');
      return sum + (radial < 1 ? Math.sign(Math.cos(v)) : 0);
    }, 0);
  }
  near(diskIntersections(R.path(0)), -1, 0, 'one negative transverse disk crossing');
  near(diskIntersections(R.path(3)), 0, 0, 'no disk crossings at separated endpoint');
  near(diskIntersections(R.path(3, true)), -1, 0, 'same certificate after omitted translation');
});

test('real view: continuous playback pauses at the actual crossing, resumes, and stops at separated endpoint', function () {
  var v = Object.create(RingsView.prototype);
  Object.assign(v, { t: 0, omitTranslation: false, playing: true, inspected: false, request3: 0, cache: null });
  for (var i = 0; i < 1000; i++) v.step(0.017);
  near(v.t, R.crossingTime, 0, 'no skipped crossing frame');
  assert(!v.playing && v.inspected, 'automatic evidence pause');
  var s = v.snapshot();
  near(s.closest.distance, 1, 0, 'live coordinates give distance');
  var before = s.closest.distance; v.camera = 'front';
  near(v.snapshot().closest.distance, before, 0, 'camera has no geometric effect');
  v.playing = true;
  for (i = 0; i < 1000; i++) v.step(0.017);
  near(v.t, 3, 0, 'endpoint without wrap'); assert(!v.playing, 'playback ends');
  near(gauss(v.snapshot().pose, 128), 0, 64 * EPS, 'actual view endpoint unlinked');
  v.setMode(true); v.playing = true; v.step(100);
  near(v.t, 3, 0, 'failure path also ends');
  near(gauss(v.snapshot().pose, 128), -1, 64 * EPS, 'actual failure-mode endpoint linked');
  v.seek(1); v.step(100); near(v.t, 1, 0, 'scrubbing pauses');
});

test('pointer controls isolate 3D pull from 4D path; cancellation clears drag and playback', function () {
  var listeners = {}, old = global.addEventListener, v = Object.create(RingsView.prototype);
  Object.assign(v, { t: 0, omitTranslation: false, playing: false, request3: 0, inspected: false,
    rects: [{ x: 0, y: 0, w: 300, h: 250 }, { x: 320, y: 0, w: 300, h: 250 }],
    canvas: { addEventListener: function (name, fn) { listeners[name] = fn; }, setPointerCapture: function () {},
      getBoundingClientRect: function () { return { left: 10, top: 20 }; } } });
  global.addEventListener = function () {};
  try { v._bindPointer(); } finally { global.addEventListener = old; }
  function pointer(name, x) { listeners[name]({ button: 0, pointerId: 1, clientX: x + 10, clientY: 120 }); }
  pointer('pointerdown', 100); pointer('pointermove', 300); pointer('pointerup', 300);
  near(v.request3, 3, 0, '3D request can target far side');
  near(R.pull3(v.request3).x, 0.8, 0, 'actual motion cannot tunnel');
  near(v.t, 0, 0, '3D input does not move 4D counterpart');
  pointer('pointerdown', 470);
  near(v.t, 1.5, 0, '4D scrub'); near(v.request3, 3, 0, '4D scrub does not reset 3D');
  v.playing = true; v.clearInput(); pointer('pointermove', 620);
  near(v.t, 1.5, 0, 'tab switch cancels capture'); assert(!v.playing, 'tab switch pauses');
});

test('invalid path and pose inputs fail explicitly rather than masquerading as safe', function () {
  [function () { R.path(NaN); }, function () { R.path(-1); }, function () { R.path(4); },
    function () { R.minimum({ x: -1, w: 0 }); }, function () { R.rings({ x: 0, w: 2 }); },
    function () { R.pull3(Infinity); }].forEach(function (f) {
    var rejected = false;
    try { f(); } catch (e) { assert(e instanceof Error, 'explicit error'); rejected = true; }
    assert(rejected, 'invalid input rejected');
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;

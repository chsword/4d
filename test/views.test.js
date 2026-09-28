'use strict';
global.window = global;
['m4', 'section', 'polytopes', 'view-projection', 'view-analogy'].forEach(function (f) { require('../js/' + f + '.js'); });
var assert = require('assert'), passed = 0, failed = 0;
function test(name, run) {
  if (process.argv[2] && name.indexOf(process.argv[2]) < 0) return;
  try { run(); passed++; console.log('PASS ' + name); }
  catch (err) { failed++; console.error('FAIL ' + name + '\n' + err.stack); }
}
function near(a, b, eps) { assert(Number.isFinite(a) && Math.abs(a - b) <= eps, a + ' vs ' + b); }
function canvas(width, height, dpr) {
  var fonts = [], panels = [], transform = [1, 1], context = {
    setTransform: function (x, b, c, y) { transform = [x, y]; },
    measureText: function (text) { return { width: Array.from(text).length * 12 }; },
    fillText: function () { fonts.push(parseFloat(this.font.match(/([\d.]+)px/)[1]) * transform[1] / dpr); },
    rect: function (x, y, w, h) { panels.push([w, h]); }
  };
  var ctx = new Proxy(context, { get: function (o, p) { return p in o ? o[p] : function () {}; } });
  return { clientWidth: width, clientHeight: height, width: width * dpr, height: height * dpr,
    getContext: function () { return ctx; }, addEventListener: function () {}, fonts: fonts, panels: panels };
}

test('F01 isoclinic button preserves arbitrary pose and gives equal actual vector angles', function () {
  for (var trial = 0; trial < 80; trial++) {
    var v = new ProjectionView(canvas(800, 600, 1));
    M4.PLANES.forEach(function (p, i) { v.angles[p] = Math.sin(trial * 7 + i * 13) * 5; });
    v.step(3);
    var original = v.rotor();
    v.startIsoclinic();
    original.forEach(function (x, i) { near(v.rotor()[i], x, 2e-14); });
    [0.001, 0.5, 1.7, 8].forEach(function (dt) {
      var A = v.rotor(); v.step(dt); var B = v.rotor();
      var cos = Math.cos(0.4 * dt);
      [0, 1, 2, 3].forEach(function (i) {
        near(M4.dot(M4.col(A, i), M4.col(B, i)), cos, 2e-13);
      });
      var increment = M4.mul(B, M4.transpose(A));
      for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
        near((increment[4 * i + j] + increment[4 * j + i]) / 2, i === j ? cos : 0, 2e-13);
      }
    });
  }
});

test('F02 every rendered panel uses stationary material coordinates while k scans independently', function () {
  var cv = canvas(390, 1200, 2), v = new AnalogyView(cv), materials = [];
  ['cubeVertices', 'tesseractVertices'].forEach(function (name) {
    var original = v[name];
    v[name] = function () { var points = original.call(this); materials.push(points); return points; };
  });
  v.step(3); v.spin = false; v.autoK = false; v.k = 0.2;
  v.draw(); var before = JSON.stringify(materials); materials = [];
  v.step(1); v.draw();
  assert.strictEqual(materials.length, 4, 'actual A/B/C/D geometry captured');
  assert.strictEqual(JSON.stringify(materials), before);
  near(v.k, 0.2, 0);
  materials = []; v.autoK = true; v.step(1); v.draw();
  assert.strictEqual(JSON.stringify(materials), before);
  assert(Math.abs(v.k - 0.2) > 0.1, 'scan still runs with spin disabled');
});

test('F05 Canvas text uses at least 12 CSS pixels and four mobile panels each have 300 pixels', function () {
  [320, 390, 1000].forEach(function (width) {
    [1, 2, 3].forEach(function (dpr) {
      var cv = canvas(width, width < 700 ? 1200 : 600, dpr);
      new AnalogyView(cv).draw();
      assert.strictEqual(cv.panels.length, 4);
      cv.panels.forEach(function (p) { assert(p[0] >= 298 && p[1] >= 298, 'readable panel area'); });
      assert(cv.fonts.length >= 15 && Math.min.apply(Math, cv.fonts) >= 12, 'analogy CSS fonts');
      var projection = canvas(width, 420, dpr);
      new ProjectionView(projection).draw();
      assert(projection.fonts.length >= 3 && Math.min.apply(Math, projection.fonts) >= 12, 'projection CSS fonts');
    });
  });
});

test('F06 vertex, whole edge, coplanar face and cell sections are unique and dimension-aware', function () {
  function check(mesh, verts, axis, k, dimension, points, edges) {
    var segs = AnalogyView.sliceFaces(verts, mesh.faces, axis, k);
    function key(p) { return p.map(function (x) { return Math.round(x * 1e8); }).join(','); }
    var unique = new Set(segs.map(function (e) { return e.map(key).sort().join('|'); }));
    assert.strictEqual(unique.size, segs.length, 'deduplicate before counting');
    assert.strictEqual(segs.dimension, dimension);
    assert.strictEqual(new Set(segs.points.map(key)).size, points);
    assert.strictEqual(unique.size, edges);
    segs.forEach(function (e) {
      assert(Math.hypot.apply(Math, e[0].map(function (x, i) { return x - e[1][i]; })) > 1e-9);
    });
    segs.points.forEach(function (p) { near(p[axis], k, 1e-12); });
  }
  var cube = AnalogyView.CUBE, tes = AnalogyView.TESSERACT;
  function diagonal3(p) {
    return [(p[0] - p[1]) / Math.sqrt(2), (p[0] + p[1] + p[2]) / Math.sqrt(3),
      (p[0] + p[1] - 2 * p[2]) / Math.sqrt(6)];
  }
  check(cube, cube.verts.map(diagonal3), 1, Math.sqrt(3), 0, 1, 0);
  var edge3 = cube.verts.map(function (p) { return [(p[0] - p[1]) / Math.sqrt(2),
    (p[0] + p[1]) / Math.sqrt(2), p[2]]; });
  check(cube, edge3, 1, Math.sqrt(2), 1, 2, 1);
  check(cube, cube.verts, 1, 1, 2, 4, 4);
  check(cube, cube.verts, 1, 1 + 1e-6, -1, 0, 0);
  check(cube, cube.verts, 1, 1 - 1e-6, 2, 4, 4);
  var diagonal4 = tes.verts.map(function (p) { return [
    (p[0] - p[1] + p[2] - p[3]) / 2, (p[0] + p[1] - p[2] - p[3]) / 2,
    (p[0] - p[1] - p[2] + p[3]) / 2, (p[0] + p[1] + p[2] + p[3]) / 2]; });
  check(tes, diagonal4, 3, 2, 0, 1, 0);
  var edge4 = tes.verts.map(function (p) { var q = diagonal3(p); return [q[0], q[2], p[3], q[1]]; });
  check(tes, edge4, 3, Math.sqrt(3), 1, 2, 1);
  var face4 = tes.verts.map(function (p) { return [(p[0] - p[1]) / Math.sqrt(2),
    p[2], p[3], (p[0] + p[1]) / Math.sqrt(2)]; });
  check(tes, face4, 3, Math.sqrt(2), 2, 4, 4);
  check(tes, face4, 3, 0, 3, 8, 12);
  check(tes, tes.verts, 3, 1, 3, 8, 12);
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

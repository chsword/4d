'use strict';

global.window = global;
require('../js/m4.js');
require('../js/section.js');
require('../js/scene4.js');
require('../js/view-slice.js');
require('../js/view-linked.js');

var fs = require('fs'), vm = require('vm'), path = require('path');
var S = Scene4, passed = 0, failed = 0, seed = 0x4d2026;
function assert(ok, message) { if (!ok) throw new Error(message); }
function near(a, b, eps, message) {
  assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps,
    message + ': ' + a + ' vs ' + b + ' (limit ' + eps + ')');
}
function vectorNear(a, b, eps, message) {
  assert(a.length === b.length, message + ' dimension');
  a.forEach(function (x, i) { near(x, b[i], eps, message + '[' + i + ']'); });
}
function test(name, run) {
  if (process.argv[2] && name.indexOf(process.argv[2]) < 0) return;
  seed = 0x4d2026;
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function object(type, params, center) {
  return { id: 'probe', type: type, params: params, center: center || [0, 0, 0, 0], material: 2 };
}
function isolated(o) { return S.create([o], true); }
var wall = S.gallery.objects.find(function (o) { return o.id === 'wall'; });
function camera(scene, position) {
  var v = Object.create(SliceView.prototype);
  Object.assign(v, { scene: scene, collisionScene: scene.collision ? scene : null, cameraRadius: 0.35,
    cam: position.slice(), yaw: 0, pitch: 0, a_xw: 0, a_zw: 0, keys: {} });
  return v;
}
function gradient(sdf, p) {
  return p.map(function (_, axis) {
    var a = p.slice(), b = p.slice(), h = 1e-5;
    a[axis] += h; b[axis] -= h;
    return (sdf(a) - sdf(b)) / (2 * h);
  });
}

test('analytic distances for all seven primitive types, including product corners', function () {
  var cases = [
    [object('floor', {}, [0, -1.5, 0, 0]), [2, 0.5, 3, 8], 2],
    [object('floor', {}, [0, -1.5, 0, 0]), [2, -2, 3, 8], -0.5],
    [object('sphere', { r: 2 }), [1, 2, 2, 4], 3],
    [object('sphere', { r: 2 }), [0, 0, 0, 0], -2],
    [object('box', { hx: 1, hy: 2, hz: 3, hw: 4 }), [4, 6, 3, 4], 5],
    [object('box', { hx: 1, hy: 2, hz: 3, hw: 4 }), [0, 0, 0, 0], -1],
    [object('duocylinder', { r1: 2, r2: 3 }), [3, 4, 0, 7], 5],
    [object('duocylinder', { r1: 2, r2: 3 }), [0, 0, 0, 0], -2],
    [object('spheritorus', { R: 3, r: 1 }), [6, 0, 0, 4], 4],
    [object('spheritorus', { R: 3, r: 1 }), [3, 0, 0, 0], -1],
    [object('tiger', { R1: 2, R2: 3, r: 1 }), [3, 4, 0, 7], 4],
    [object('tiger', { R1: 2, R2: 3, r: 1 }), [2, 0, 3, 0], -1],
    [object('pillar', { r: 2, h: 3 }), [3, 7, 4, 99], 5],
    [object('pillar', { r: 2, h: 3 }), [0, 0, 0, -99], -2]
  ];
  cases.forEach(function (c) { near(isolated(c[0]).sdf(c[1]), c[2], 1e-12, c[0].type); });
});

test('unit SDF gradients away from surfaces and medial/CSG seams', function () {
  S.gallery.objects.forEach(function (o) {
    var sdf = isolated(o).sdf;
    for (var i = 0; i < 50; i++) {
      // Smooth exterior points, not symmetry axes, edges or equal-distance seams.
      var p = M4.add(o.center, [12.37 + random(), 5.29 + random(), 4.73 + random(), 3.11 + random()]);
      assert(Math.abs(sdf(p)) > 0.1, 'away from surface');
      near(M4.len(gradient(sdf, p)), 1, 3e-9, o.id + ' unit gradient');
    }
  });
  [[0, 1, 3, 0], [0, 0.4, -15, 0], [-8, 0.3, -7, 0], [0, 0.4, -17, 3]].forEach(function (p) {
    near(M4.len(gradient(S.gallery.sdf, p)), 1, 3e-9, 'scene exterior gradient');
  });
});

test('all primitive fields and the union are 1-Lipschitz', function () {
  S.gallery.objects.map(isolated).concat([S.gallery]).forEach(function (scene) {
    for (var i = 0; i < 200; i++) {
      var a = Array.from({ length: 4 }, function () { return 30 * random() - 15; });
      var b = M4.add(a, Array.from({ length: 4 }, function () { return 3 * random() - 1.5; }));
      assert(Math.abs(scene.sdf(a) - scene.sdf(b)) <= M4.len(M4.sub(a, b)) + 1e-12, 'Lipschitz bound');
    }
  });
});

// Parse emitted expressions independently; this is structural validation, not a GLSL compiler.
function parseExpression(source) {
  var tokens = source.match(/p\.[xyzw]|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d*)?(?:e[+-]?\d+)?|[-+(),]/g), at = 0;
  function atom() {
    var token = tokens[at++];
    if (token === '(') {
      var left = expression();
      assert(tokens[at++] === ')', 'closing parenthesis'); return left;
    }
    if (/^\d/.test(token)) return Number(token);
    if (tokens[at] !== '(') return token;
    at++;
    var args = [];
    do { args.push(expression()); } while (tokens[at++] === ',');
    assert(tokens[at - 1] === ')', 'call closing parenthesis');
    if (token === 'length') {
      assert(args.length === 1 && /^vec[234]$/.test(args[0].op), 'length vector');
      return { op: 'length', args: args[0].args };
    }
    return { op: token, args: args };
  }
  function expression() {
    var left = atom();
    while (tokens[at] === '+' || tokens[at] === '-') {
      var op = tokens[at++];
      left = { op: op === '+' ? 'add' : 'sub', args: [left, atom()] };
    }
    return left;
  }
  var result = expression();
  assert(at === tokens.length, 'no unparsed tokens');
  return result;
}
test('GLSL primitive bodies have exactly the CPU expression trees and signatures', function () {
  Object.keys(S.types).forEach(function (key) {
    var type = S.types[key];
    var match = S.library.match(new RegExp('float ' + type.name + '\\(vec4 p([^)]*)\\)\\{ return ([^;]+); \\}'));
    assert(match, key + ' generated helper');
    var names = match[1].match(/[A-Za-z_][A-Za-z_0-9]*/g) || [];
    vectorNear([names.length], [type.params.length * 2], 0, 'parameter count');
    type.params.forEach(function (p, i) { assert(names[2 * i] === 'float' && names[2 * i + 1] === p, 'parameter signature'); });
    assert(JSON.stringify(parseExpression(match[2])) === JSON.stringify(type.expression), key + ' same AST');
  });
  assert(!/[^\x00-\x7f]/.test(S.library + S.gallery.map), 'ASCII GLSL');
  assert(!/\?/.test(S.library + S.gallery.map), 'no ternaries');
});

test('generated map count, order, types, centers, parameters and materials match CPU coverage', function () {
  [S.gallery, S.linked].forEach(function (scene) {
    var calls = Array.from(scene.map.matchAll(/vec2\((sd\w+)\(p - vec4\(([^)]+)\)((?:, [-+\d.e]+)*)\), ([-+\d.e]+)\)/g));
    assert(calls.length === scene.objects.length, 'one GLSL call per CPU primitive');
    assert((scene.map.match(/opU\(/g) || []).length === calls.length - 1, 'one union fold');
    calls.forEach(function (call, i) {
      var o = scene.objects[i], type = S.types[o.type];
      assert(call[1] === type.name, 'primitive type');
      vectorNear(call[2].split(',').map(Number), o.center, 0, 'center literals');
      vectorNear(call[3] ? call[3].slice(2).split(',').map(Number) : [],
        type.params.map(function (key) { return o.params[key]; }), 0, 'parameter literals');
      near(Number(call[4]), o.material, 0, 'material');
    });
    var individual = scene.objects.map(isolated);
    for (var i = 0; i < 100; i++) {
      var p = [25 * random() - 12.5, 6 * random() - 2, -25 * random(), 10 * random() - 5];
      var expected = Infinity, id;
      individual.forEach(function (s, j) {
        var d = s.sdf(p);
        if (d <= expected) { expected = d; id = scene.objects[j].id; }
      });
      near(scene.sdf(p), expected, 1e-13, 'all CPU entries evaluated');
      assert(scene.sample(p).object.id === id, 'same tie/identity rule');
    }
  });
});

test('scene data is immutable and parameter changes affect both backends', function () {
  var source = object('sphere', { r: 2 }, [1, 2, 3, 4]), scene = isolated(source);
  source.center[0] = 99; source.params.r = 88;
  near(scene.sdf([1, 2, 3, 9]), 3, 1e-13, 'snapshot not caller data');
  assert(Object.isFrozen(scene.objects[0].params) && Object.isFrozen(scene.objects[0].center), 'deep freeze');
  var changed = isolated(object('sphere', { r: 4 }, [1, 2, 3, 4]));
  near(changed.sdf([1, 2, 3, 9]), 1, 1e-13, 'changed CPU radius');
  assert(changed.map.indexOf(', 4.0)') >= 0 && scene.map.indexOf(', 2.0)') >= 0, 'changed GLSL radius');
  [object('unknown', {}), object('sphere', { r: -1 }), object('sphere', { r: NaN }),
    object('sphere', { r: 1, ignored: 9 }), object('sphere', { r: 1 }, [1, 2])].forEach(function (o) {
    var threw = false;
    try { isolated(o); } catch (err) { threw = err instanceof TypeError; }
    assert(threw, 'invalid data must fail explicitly');
  });
});

test('w=0 blocks forward travel; w=3 permits exactly the same requested displacement', function () {
  var requested = [0, 0, -4, 0], start = [0, 0.4, -15, 0];
  var blocked = S.gallery.move(start, requested, 0.35);
  assert(M4.len(M4.sub(blocked, start)) < M4.len(requested) * 0.34, 'significantly blocked, not endpoint-only');
  near(blocked[2], -16.35 + 1e-6, 2e-9, 'radius before wall');
  var freeStart = [0, 0.4, -15, 3], free = S.gallery.move(freeStart, requested, 0.35);
  vectorNear(M4.sub(free, freeStart), requested, 1e-12, 'w=3 exact requested motion');
});

test('diagonal contact retains x/y/w tangents and removes the z normal component', function () {
  var p = [0, 0.4, -15, 0], delta = [2, 0.2, -4, 0.3];
  var out = S.gallery.move(p, delta, 0.35);
  [0, 1, 3].forEach(function (axis) { near(out[axis] - p[axis], delta[axis], 1e-10, 'full tangent'); });
  near(out[2], -16.35 + 1e-6, 2e-9, 'normal stopped');
  var again = S.gallery.move(out, [0.1, 0, -1, 0], 0.35);
  near(again[0] - out[0], 0.1, 1e-10, 'resting wall slide');
  near(again[2], out[2], 2e-9, 'resting normal removed');
});

test('high-speed repeated sweeps cannot tunnel through any of the eight wall faces', function () {
  var scene = isolated(wall), h = [9, 2, 0.3, 1.6];
  for (var axis = 0; axis < 4; axis++) {
    [-1, 1].forEach(function (sign) {
      [20, 1000, 100000].forEach(function (speed) {
        var p = wall.center.slice(), d = [0, 0, 0, 0];
        p[axis] += sign * (h[axis] + 2);
        d[axis] = -sign * speed;
        for (var i = 0; i < 5; i++) {
          p = scene.move(p, d, 0.35);
          assert(sign * (p[axis] - wall.center[axis]) >= h[axis] + 0.35 - 1e-10, 'same outside side');
          assert(scene.sdf(p) >= 0.35 - 1e-10, 'no radius penetration');
          near(sign * (p[axis] - wall.center[axis]), h[axis] + 0.35 + 1e-6, 3e-9, 'tight contact');
        }
      });
    });
  }
});

test('thin geometry and fourth-axis sweeps are continuous, including w-slider routes', function () {
  var thin = isolated(object('box', { hx: 3, hy: 3, hz: 0.00001, hw: 0.00001 }));
  [2, 3].forEach(function (axis) {
    var p = [0, 0, 0, 0], d = [0, 0, 0, 0]; p[axis] = 100; d[axis] = -200;
    var out = thin.move(p, d, 0.35);
    near(out[axis], 0.350011, 2e-9, 'thin face not crossed');
  });
  var v = camera(S.gallery, [0, 0.4, -17, 3]);
  v.setW(0);
  near(v.cam[3], 1.950001, 2e-9, 'slider cannot teleport into wall');
  v.resetW();
  near(v.cam[3], 1.950001, 2e-9, 'orientation reset cannot teleport either');
  v.setW(3);
  near(v.cam[3], 3, 1e-12, 'can move away');
});

test('floor and wall corner retains common tangent through repeated contacts', function () {
  var scene = S.linked, p = [0, 0.4, -15, 0];
  p = scene.move(p, [0.5, -5, -5, 0], 0.35);
  near(p[0], 0.5, 1e-10, 'corner tangent');
  near(p[1], -1.15 + 1e-6, 2e-9, 'floor radius');
  near(p[2], -16.35 + 1e-6, 2e-9, 'wall radius');
  for (var i = 0; i < 30; i++) {
    p = scene.move(p, [0.01, -10, -10, 0], 0.35);
    assert(scene.sdf(p) >= 0.35 - 1e-10, 'corner no penetration');
  }
  near(p[0], 0.8, 2e-10, 'common tangent conserved');
});

test('sweeps and grazing slides cover curved and nonconvex gallery primitives', function () {
  S.gallery.objects.filter(function (o) { return o.type !== 'floor'; }).forEach(function (o) {
    var scene = isolated(o), p = M4.add(o.center, [0, 0, 10, 0]);
    var result = scene.move(p, [1, 0, -20, 0], 0.35);
    assert(scene.sdf(result) >= 0.35 - 1e-9, o.id + ' outside');
    assert(M4.len(M4.sub(result, M4.add(p, [1, 0, -20, 0]))) > 0.1, o.id + ' collided rather than unchecked endpoint');
    var params = o.params;
    var extent = { sphere: params.r, box: params.hz, duocylinder: params.r2,
      spheritorus: params.R + params.r, tiger: params.R2 + params.r, pillar: params.r }[o.type];
    // A direct normal strike cannot slide around a narrow pillar. For tiger,
    // place x on the first ring rather than shooting through its empty center.
    p = M4.add(o.center, [o.type === 'tiger' ? params.R1 : 0, 0, 10, 0]);
    result = scene.move(p, [0, 0, -20, 0], 0.35);
    near(result[2] - o.center[2], extent + 0.35 + 1e-6, 2e-9, o.id + ' normal strike');
  });
});

test('SliceView.step uses swept collision at large dt and honors rotated 4D movement', function () {
  var v = camera(S.gallery, [0, 0.4, -15, 0]);
  v.keys = { keyw: true, shiftleft: true }; v.step(10);
  near(v.cam[2], -16.35 + 1e-6, 2e-9, 'actual step blocked');
  var free = camera(S.gallery, [0, 0.4, -15, 3]);
  free.keys = { keyw: true }; free.step(4 / 5.5);
  vectorNear(free.cam, [0, 0.4, -19, 3], 1e-12, 'actual step at w3 free');
  var rotated = camera(isolated(wall), [0, 0.5, -17, 3]);
  rotated.a_zw = Math.PI / 2; rotated.keys = { keyw: true }; rotated.step(10);
  near(rotated.cam[3], 1.950001, 2e-9, 'rotated forward hits fourth face');
});

[51, 42, 20260928].forEach(function (initialSeed) {
test('400 seeded nonconvex trajectories preserve clearance and terminate at concave contacts, seed=' + initialSeed, function () {
  seed = initialSeed;
  S.gallery.objects.filter(function (o) { return o.type === 'spheritorus' || o.type === 'tiger'; }).forEach(function (o) {
    var scene = isolated(o);
    for (var i = 0; i < 200; i++) {
      var offset = Array.from({ length: 4 }, function () { return 4 * (random() - 0.5); });
      var p = M4.add(o.center, offset);
      if (scene.sdf(p) < 0.35001) { i--; continue; }
      var delta = M4.add(M4.scale(offset, -2), Array.from({ length: 4 }, function () { return random() - 0.5; }));
      var out = scene.move(p, delta, 0.35), q = M4.sub(out, o.center), params = o.params;
      var distance = o.type === 'spheritorus'
        ? Math.hypot(Math.hypot(q[0], q[1], q[2]) - params.R, q[3]) - params.r
        : Math.hypot(Math.hypot(q[0], q[1]) - params.R1, Math.hypot(q[2], q[3]) - params.R2) - params.r;
      assert(distance >= 0.35 - 1e-9, 'independent analytic clearance: ' + o.id + ' case ' + i);
      assert(M4.len(M4.sub(out, p)) <= M4.len(delta) + 1e-9, 'contact projection cannot add travel');
    }
  });
});
});

test('F03 small gallery displacement leaves a concave tangent with certified clearance', function () {
  var p = [4.116084859822875, 0.06933066034689572, -9.764552097418338, 0.038078714860602936];
  var d = [0.10130974465282634, -0.12990554473362864, -0.00947153369197622, -0.18724242721218615];
  assert(S.gallery.sdf(p) - 0.35 > 0.0014, 'safe initial position');
  [1, 20, 50].forEach(function (count) {
    var q = p.slice();
    for (var i = 0; i < count; i++) {
      q = S.gallery.move(q, M4.scale(d, 1 / count), 0.35);
      assert(S.gallery.sdf(q) >= 0.35 - 1e-10, 'no penetration');
    }
    assert(M4.len(M4.sub(q, p)) > 0.05, 'must make real progress, not just return the start');
    assert(M4.len(M4.sub(q, p)) <= M4.len(d) + 1e-9, 'no added travel');
  });
});

test('exactly touching nonconvex start separates safely before a tangent sweep', function () {
  var o = S.gallery.objects.find(function (item) { return item.id === 'spheritorus'; }), scene = isolated(o);
  var p = M4.add(o.center, [0, 0, o.params.R + o.params.r + 0.35, 0]);
  var out = scene.move(p, [0.2, 0, 0, 0], 0.35);
  near(out[0] - p[0], 0.2, 1e-12, 'tangent retained');
  near(out[2] - p[2], 1e-6, 2e-12, 'only the explicit skin separation');
  assert(scene.sdf(out) > 0.35, 'outside after tangent');
});

test('custom scenes default to no camera collision and preserve sandbox floor clamp', function () {
  var scene = S.create(S.gallery.objects), v = camera(scene, [0, 0.4, -15, 0]);
  assert(scene.collision === false, 'opt in only');
  v.keys = { keyw: true }; v.step(4 / 5.5);
  near(v.cam[2], -19, 1e-12, 'no gallery collision leakage');
  v.keys = { keyc: true }; v.step(10);
  near(v.cam[1], -1.1, 0, 'legacy sandbox floor clamp');
});

test('box sections at w=0, w=3 and coplanar faces are exact and deduplicated', function () {
  var mesh = LinkedView.boxMesh(wall);
  assert(mesh.verts.length === 16 && mesh.edges.length === 32 && mesh.faces.length === 24, '4D box mesh');
  [0, 1.6, -1.6].forEach(function (w) {
    var cut = LinkedView.section(mesh, [0, 0, 0, w], [0, 0, 0, 1]);
    assert(cut.verts.length === 8 && cut.edges.length === 12, 'cube section including coplanar case');
    cut.verts.forEach(function (p) { near(p[3], w, 1e-14, 'exact plane'); });
    var keys = cut.edges.map(function (e) { return e.slice().sort().join(':'); });
    assert(new Set(keys).size === 12, 'no duplicate edges');
  });
  assert(LinkedView.section(mesh, [0, 0, 0, 3], [0, 0, 0, 1]).verts.length === 0, 'wall absent at3');
  var gold = S.linked.objects.find(function (o) { return o.id === 'treasure'; });
  assert(LinkedView.section(LinkedView.boxMesh(gold), [0, 0, 0, 3], [0, 0, 0, 1]).edges.length === 12, 'gold present at3');
});

test('tilted hyperplanes and tangent vertices preserve world coordinates and topology', function () {
  var o = object('box', { hx: 1, hy: 1, hz: 1, hw: 1 }), mesh = LinkedView.boxMesh(o);
  var tangent = LinkedView.section(mesh, [1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5]);
  assert(tangent.verts.length === 1 && tangent.edges.length === 0, 'single tangent material point');
  for (var i = 0; i < 60; i++) {
    var n = M4.normalize([random() + 0.1, random() + 0.2, random() + 0.3, random() + 0.4]);
    var c = M4.scale(n, 0.4 * random()), cut = LinkedView.section(mesh, c, n);
    assert(cut.edges.length >= 6, 'nonempty 3D section');
    cut.verts.forEach(function (p, j) {
      near(M4.dot(M4.sub(p, c), n), 0, 1e-12, 'same H');
      near(isolated(o).sdf(p), 0, 1e-12, 'on original material boundary');
      assert(cut.edges.filter(function (e) { return e.indexOf(j) >= 0; }).length === 3, 'generic vertex degree');
    });
  }
});

test('hyperplane window is a moving rank-three volume, not a two-dimensional sheet', function () {
  var v = camera(S.linked, [1, 0.4, -14, 0.8]);
  v.a_xw = 0.4; v.a_zw = -0.7; v.yaw = 0.8; v.pitch = 0.3;
  var F = v.frame(), n = M4.col(F, 3), mesh = LinkedView.windowMesh(v.cam, F);
  assert(mesh.verts.length === 8 && mesh.edges.length === 12, '3D window');
  mesh.verts.forEach(function (p) { near(M4.dot(M4.sub(p, v.cam), n), 0, 2e-14, 'window in H'); });
  var spans = [1, 2, 4].map(function (i) { return M4.sub(mesh.verts[i], mesh.verts[0]); });
  [6, 3.2, 8].forEach(function (length, i) { near(M4.len(spans[i]), length, 2e-14, 'nonzero independent extent'); });
  near(M4.dot(spans[0], spans[1]), 0, 2e-14, 'independent axes');
  near(M4.dot(spans[1], spans[2]), 0, 2e-14, 'independent axes');
  var delta = [0.2, 0.3, 0.4, 0.5], moved = LinkedView.windowMesh(M4.add(v.cam, delta), F);
  mesh.verts.forEach(function (p, i) { vectorNear(M4.sub(moved.verts[i], p), delta, 2e-14, 'window follows camera'); });
});

test('crosshair identity, world point and material coordinates agree with the slice ray', function () {
  var p = [0, 0.4, -13, 0], direction = [0, 0, -1, 0], hit = S.linked.raycast(p, direction);
  assert(hit.object.id === 'wall', 'wall identity not closest screen pixel');
  vectorNear(M4.add(hit.object.center, hit.local), hit.point, 1e-13, 'same material point');
  vectorNear(hit.point, M4.add(p, M4.scale(direction, hit.distance)), 1e-13, 'same ray');
  assert(S.linked.sdf(hit.point) < 0.0018 * Math.max(1, hit.distance), 'same shader hit tolerance');
  assert(S.linked.sdf(hit.point) >= 0, 'hit from outside');
  var goldHit = S.linked.raycast([0, -0.7, -18, 3], direction);
  assert(goldHit.object.id === 'treasure', 'same ray at w3 reaches treasure');
});

test('prediction reveals actual selected-object section and reports blocked w travel', function () {
  var linked = Object.create(LinkedView.prototype);
  linked.scene = S.linked;
  linked.objects = S.linked.objects.filter(function (o) { return o.type === 'box'; });
  linked.meshes = linked.objects.map(LinkedView.boxMesh);
  linked.slice = camera(S.linked, [0, 0.4, -13, 0]); linked.selected = 'wall';
  var result = linked.predict(3, false);
  assert(result.correct && result.reached && !result.exists, 'predict wall disappears');
  linked.selected = 'treasure';
  result = linked.predict(3, true);
  assert(result.correct && result.exists, 'predict gold appears');
  linked.slice.cam = [0, 0.4, -17, 3];
  assert(!linked.predict(0, true).reached, 'blocked travel is not scored as target-layer result');
});

function browser() {
  var html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'), nodes = {}, shaders = [], errors = [];
  function element(id) {
    var listeners = {}, classes = new Set();
    return { id: id, value: '0', checked: false, style: {}, dataset: {}, tagName: 'DIV',
      clientWidth: 500, width: 500, height: 700, textContent: '', innerHTML: '',
      classList: { toggle: function (name, on) { if (on) classes.add(name); else classes.delete(name); },
        contains: function (name) { return classes.has(name); } },
      addEventListener: function (name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); },
      emit: function (name, e) { (listeners[name] || []).forEach(function (fn) { fn.call(this, e || {}); }, this); },
      setPointerCapture: function () {}, blur: function () { env.document.activeElement = null; },
      appendChild: function () {}, insertRow: function () { return element('row'); }, deleteRow: function () {},
      insertCell: function () { return element('cell'); },
      querySelector: function (selector) { assert(selector === 'tbody', 'supported table selector'); return element('tbody'); },
      getBoundingClientRect: function () { return { width: env.innerWidth > 860 ? 1000 : env.innerWidth, height: 700 }; }
    };
  }
  function gl() {
    var out = { uniforms: {}, MAX_FRAGMENT_UNIFORM_VECTORS: 1, VERTEX_SHADER: 2, FRAGMENT_SHADER: 3,
      createShader: function (type) { return { type: type }; },
      shaderSource: function (shader, source) { shaders.push(source); },
      getShaderParameter: function () { return true; }, getProgramParameter: function () { return true; },
      getParameter: function () { return 128; }, getUniformLocation: function (_, name) { return name; } };
    ['createProgram', 'createBuffer', 'getAttribLocation', 'attachShader', 'compileShader', 'linkProgram', 'useProgram',
      'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'drawArrays'].forEach(function (key) {
      out[key] = function () { return {}; };
    });
    ['uniform1f', 'uniform1i', 'uniform2f', 'uniform4fv', 'uniform1fv', 'uniformMatrix4fv'].forEach(function (key) {
      out[key] = function (name, value) { out.uniforms[name] = typeof value === 'object' ? Array.from(value) : value; };
    });
    return out;
  }
  var env = element('window');
  env.innerWidth = 1300; env.devicePixelRatio = 1; env.window = env;
  env.console = { log: function () {}, error: function (err) { errors.push(err); } };
  env.performance = { now: function () { return 0; } };
  env.getComputedStyle = function () {
    return { getPropertyValue: function (name) {
      var value = html.match(new RegExp(name + ':\\s*(#[0-9a-f]+)'));
      assert(value, 'existing CSS variable'); return value[1];
    } };
  };
  env.requestAnimationFrame = function (fn) { env.tick = fn; };
  env.document = element('document');
  env.document.createElement = function (tag) { return element(tag); };
  env.document.getElementById = function (id) { assert(nodes[id], 'existing DOM id: ' + id); return nodes[id]; };
  env.document.exitPointerLock = function () { env.document.pointerLockElement = null; };
  var tabs = [], panels = [];
  Array.from(html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)).forEach(function (match) {
    var node = element(match[3]); nodes[node.id] = node; node.tagName = match[1].toUpperCase();
    var value = match[2].match(/\bvalue="([^"]+)"/); if (value) node.value = value[1];
    node.checked = /\bchecked\b/.test(match[2]);
    if (match[1] === 'canvas') {
      node.gl = gl();
      node.getContext = function (kind) {
        if (kind !== '2d') return node.gl;
        return new Proxy({}, { get: function (_, name) {
          if (name === 'measureText') return function () { return { width: 50 }; };
          return function () {};
        }, set: function () { return true; } });
      };
    }
  });
  Array.from(html.matchAll(/<(button|section) class="(tab|panel)[^"]*" data-view="([^"]+)"/g)).forEach(function (match) {
    var node = element(match[3]); node.dataset.view = match[3];
    (match[2] === 'tab' ? tabs : panels).push(node);
  });
  env.document.querySelectorAll = function (selector) {
    if (selector === '.tab') return tabs;
    if (selector === '.panel') return panels;
    assert(['[id^="ch-"]', '[id^="rg-"]', '[id^="nt-"]', '[id^="sx-"]'].includes(selector), 'supported DOM selector');
    var prefix = selector.slice(6, 9);
    return Object.keys(nodes).filter(function (id) { return id.indexOf(prefix) === 0; }).map(function (id) { return nodes[id]; });
  };
  vm.createContext(env);
  Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).forEach(function (match) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', match[1]), 'utf8'), env, { filename: match[1] });
  });
  return { env: env, nodes: nodes, tabs: tabs, shaders: shaders, errors: errors };
}

test('real script order and constructors preserve ASCII shaders and sandbox opt-out', function () {
  var b = browser();
  assert(b.errors.length === 0, 'all actual view constructors initialize');
  b.shaders.forEach(function (s) {
    assert(!/[^\x00-\x7f]/.test(s), 'full shader ASCII');
    assert(!/\?/.test(s.replace(/\/\/[^\n]*/g, '')), 'no shader ternaries');
    assert(!/SCENE_(MAP|UNIFORMS)/.test(s), 'all injection points replaced');
  });
  var view = new b.env.PhysicsView(b.nodes['cv-physics']);
  assert(view.collisionScene === null && view.scene.collision === false, 'dynamic scene explicitly opts out');
  assert(b.shaders.some(function (s) { return s.indexOf('uInvR[') >= 0; }), 'dynamic shader retained');
  assert(b.shaders.some(function (s) { return s.indexOf(S.gallery.map) >= 0; }), 'gallery generated shader used');
  assert(b.shaders.some(function (s) { return s.indexOf(S.linked.map) >= 0; }), 'linked generated shader used');
});

test('application wiring: linked movement, sliders, tab cleanup, resize and frame rendering', function () {
  var b = browser(), env = b.env, nodes = b.nodes, time = 0;
  function select(name) { b.tabs.find(function (tab) { return tab.dataset.view === name; }).emit('click'); }
  function frame(n) { for (var i = 0; i < n; i++) { time += 50; env.tick(time); } }
  function key(code, down) { env.emit(down ? 'keydown' : 'keyup', { code: code, target: { tagName: 'BODY' }, preventDefault: function () {} }); }
  select('linked'); frame(1);
  assert(nodes['cv-linked'].classList.contains('active') && nodes['cv-linked-slice'].classList.contains('active'), 'both canvases visible');
  assert(nodes['cv-linked-slice'].style.left === '500px', 'side-by-side placement');
  key('KeyW', true); frame(20); key('KeyW', false);
  var gl = nodes['cv-linked-slice'].gl;
  near(gl.uniforms.uCam[2], -16.35 + 1e-6, 2e-9, 'live linked camera blocked');
  nodes['linked-w'].value = '3'; nodes['linked-w'].emit('input');
  key('KeyW', true); frame(2); key('KeyW', false);
  near(gl.uniforms.uCam[2], -16.9 + 1e-6, 2e-9, 'live camera passes at3');
  nodes['linked-w'].value = '0'; nodes['linked-w'].emit('input'); frame(1);
  near(gl.uniforms.uCam[3], 1.950001, 2e-9, 'live slider cannot embed camera');
  near(Number(nodes['linked-w'].value), gl.uniforms.uCam[3], 1e-12, 'slider displays reached coordinate');
  assert(nodes['linked-readout'].textContent.indexOf('w=1.95') >= 0, 'readout follows actual position');
  key('KeyD', true); select('slice'); select('linked'); frame(1);
  near(gl.uniforms.uCam[0], 0, 1e-12, 'switch clears held input');
  env.innerWidth = 600; env.emit('resize');
  assert(nodes['cv-linked-slice'].style.left === '0' && nodes['cv-linked-slice'].style.top === '350px', 'stacked on narrow screen');
  assert(b.tabs.length === 9 && b.tabs[5].dataset.view === 'chirality' && b.tabs[6].dataset.view === 'rings' &&
    b.tabs[7].dataset.view === 'net' && b.tabs[8].dataset.view === 'simplex', 'existing order retained; simplex ninth');
  select('chirality'); frame(1);
  assert(nodes['cv-chirality'].classList.contains('active') && !nodes['cv-linked'].classList.contains('active'), 'isolated sixth canvas');
  nodes['ch-best'].emit('click'); frame(1);
  near(parseFloat(nodes['ch-error3'].textContent), 17.888544, 1e-6, 'wired best 3D pose remains mismatched');
  nodes['ch-middle'].emit('click'); frame(1);
  near(Number(nodes['ch-volume'].textContent), 0.048, 1e-12, 'wired invariant at 90 degrees');
  assert(nodes['ch-angle-val'].textContent === '90.0°', 'middle button stops exactly at 90');
  nodes['ch-end'].emit('click'); frame(1);
  assert(parseFloat(nodes['ch-error4'].textContent) < 1e-15, 'wired endpoint matches');
  nodes['ch-start'].emit('click'); nodes['ch-play'].emit('click'); frame(1);
  var angle = nodes['ch-angle-val'].textContent;
  select('analogy'); frame(5); select('chirality'); frame(1);
  assert(nodes['ch-angle-val'].textContent === angle, 'tab switch stops chirality playback');
  select('rings'); frame(1);
  assert(nodes['cv-rings'].classList.contains('active') && !nodes['cv-chirality'].classList.contains('active'), 'isolated seventh canvas');
  nodes['rg-attempt'].emit('click'); frame(1);
  assert(nodes['rg-contact'].textContent.indexOf('x=0.800000') >= 0, 'wired 3D first-contact stop');
  nodes['rg-crossing'].emit('click'); frame(1);
  assert(nodes['rg-witness'].textContent.indexOf('wB=1.000') >= 0, 'wired hidden-direction evidence');
  near(parseFloat(nodes['rg-distance'].textContent), 1, 0, 'actual 4D distance at crossing');
  nodes['rg-end'].emit('click'); frame(1);
  assert(nodes['rg-status'].textContent.indexOf('链环数 0') >= 0, 'full path separates');
  [0, 1 - 1e-6, 1, 1 + 1e-6, 2 - 1e-6, 2, 2 + 1e-6, 3].forEach(function (t) {
    nodes['rg-time'].value = String(t); nodes['rg-time'].emit('input'); frame(1);
    var w = t < 1 ? t : t < 2 ? 1 : 3 - t;
    var bound = t < 1 ? Math.hypot(1, w) : t < 2 ? 1 : 2;
    var formula = t < 1 ? '√(1+w²)' : t < 2 ? '1' : '2';
    assert(nodes['rg-bound'].textContent === '≥ ' + formula + ' = ' + bound.toFixed(6), 'F11 actual displayed centerline certificate');
    assert(nodes['rg-gap'].textContent.indexOf('保证 ≥ ' + (bound - 0.2).toFixed(6)) >= 0, 'F11 actual displayed tube gap');
  });
  nodes['rg-mode'].value = 'omit'; nodes['rg-mode'].emit('change');
  nodes['rg-end'].emit('click'); frame(1);
  assert(nodes['rg-status'].textContent.indexOf('仍为 −1') >= 0, 'omitted translation stays linked');
  assert(nodes['rg-bound'].textContent.indexOf('1.000000') >= 0, 'failure mode uses its own bound');
  nodes['rg-start'].emit('click'); nodes['rg-play'].emit('click'); frame(1);
  var ringTime = nodes['rg-time-val'].textContent;
  select('projection'); frame(1); select('rings'); frame(1);
  assert(nodes['rg-time-val'].textContent === ringTime, 'tab switch pauses rings');
  select('net'); frame(1);
  assert(nodes['cv-net'].classList.contains('active') && !nodes['cv-rings'].classList.contains('active'), 'isolated eighth canvas');
  nodes['nt-cell'].value = '7'; nodes['nt-cell'].emit('change');
  nodes['nt-middle'].emit('click'); frame(1);
  assert(nodes['nt-identity'].textContent.indexOf('8 H') === 0, 'material identity survives folding');
  assert(nodes['nt-angles'].textContent === 'θ=90.00° · φ=0.00°', 'exact phase boundary');
  assert(nodes['nt-joined'].textContent.indexOf('新接合 12/17') >= 0, 'only five lid seams remain open');
  nodes['nt-end'].emit('click'); frame(1);
  assert(nodes['nt-joined'].textContent.indexOf('新接合 17/17') >= 0, 'all new faces join');
  assert(nodes['nt-status'].textContent.indexOf('48 张胞面逐一配成 24 对') >= 0, 'visible per-face closure evidence');
  var material = nodes['nt-point'].textContent;
  nodes['nt-mode'].value = 'ortho'; nodes['nt-mode'].emit('change'); frame(1);
  assert(nodes['nt-point'].textContent === material, 'camera cannot change material points');
  nodes['nt-home'].emit('click'); frame(1);
  assert(nodes['nt-identity'].textContent.indexOf('1 A') === 0, 'find the original cell without resetting time');
  assert(nodes['nt-time-val'].textContent === '100.0%', 'identity selection does not unfold');
  nodes['nt-start'].emit('click'); nodes['nt-play'].emit('click'); frame(2);
  var netTime = nodes['nt-time-val'].textContent;
  select('projection'); frame(1); select('net'); frame(1);
  assert(nodes['nt-time-val'].textContent === netTime, 'tab switch pauses net');
  select('simplex'); frame(1);
  assert(nodes['cv-simplex'].classList.contains('active') && !nodes['cv-net'].classList.contains('active'), 'isolated ninth canvas');
  assert(nodes['sx-w'].disabled, 'starts with only xyz controls');
  nodes['sx-best'].emit('click'); frame(1);
  assert(nodes['sx-error'].textContent.includes('26.742346%'), 'wired corrected global minimum');
  nodes['sx-center'].emit('click'); frame(1);
  assert(nodes['sx-error'].textContent.includes('38.762756%'), 'centroid is explicitly worse');
  nodes['sx-positive'].emit('click'); frame(1);
  assert(nodes['sx-status'].textContent.includes('机器精度精确解'), 'wired analytic solution');
  var metric = nodes['sx-error'].textContent, coords = nodes['sx-points'].textContent;
  nodes['sx-mode'].value = 'perspective'; nodes['sx-mode'].emit('change'); frame(1);
  assert(nodes['sx-error'].textContent === metric && nodes['sx-points'].textContent === coords, 'camera is not metric');
  nodes['sx-size'].emit('click'); frame(1);
  assert(nodes['sx-w'].disabled && !nodes['sx-unlock'].checked, 'new transfer resets and relocks');
  nodes['sx-low'].emit('click'); frame(1);
  assert(nodes['sx-z'].disabled && nodes['sx-w'].disabled && nodes['sx-task'].textContent.includes('六条'), 'low version consistently starts in plane');
  nodes['sx-unlock'].checked = true; nodes['sx-unlock'].emit('change'); frame(1);
  assert(!nodes['sx-z'].disabled && nodes['sx-w'].disabled, 'only z opens for triangle');
  nodes['sx-negative'].emit('click'); frame(1);
  nodes['sx-prediction'].value = 'pythagoras'; nodes['sx-check'].emit('click'); frame(1);
  assert(nodes['sx-feedback'].textContent.includes('不计通过'), 'revealed low-dimensional answer not a transfer pass');
  assert(b.errors.length === 0, 'no runtime failures during live frames');
});

test('F08 parallel and rotated section claims follow the actual primitive SDFs', function () {
  var duo = isolated(object('duocylinder', { r1: 1.15, r2: 1.15 }));
  [0, 0.4, 1.14, 1.15].forEach(function (w) {
    var halfHeight = Math.sqrt(1.15 * 1.15 - w * w);
    near(duo.sdf([0, 0, halfHeight, w]), 0, 3e-16, 'cylinder end/disc');
    assert(duo.sdf([0, 0, 0, w]) <= 0, 'filled axis, no annular hole');
  });
  assert(duo.sdf([0, 0, 0, 1.16]) > 0, 'duocylinder vanishes beyond endpoint');
  var torus = isolated(object('spheritorus', { R: 1.15, r: 0.45 }));
  [0, 0.3, 0.44, 0.45].forEach(function (w) {
    var h = Math.sqrt(0.45 * 0.45 - w * w);
    [-1, 1].forEach(function (sign) {
      near(torus.sdf([1.15 + sign * h, 0, 0, w]), 0, 3e-16, 'spherical shell radii');
    });
  });
  assert(torus.sdf([1.15, 0, 0, 0.46]) > 0, 'spherical shell vanishes');
  // z=0 after a pi/2 zw turn: (sqrt(x*x+y*y)-R)^2+w*w<=r*r.
  for (var i = 0; i < 100; i++) {
    var u = i * 0.71, v = i * 1.31, r = 1.15 + 0.45 * Math.cos(v);
    near(torus.sdf([r * Math.cos(u), r * Math.sin(u), 0, 0.45 * Math.sin(v)]), 0, 6e-16, 'tilted solid torus boundary');
  }
  var v = camera(S.gallery, [4, 0.3, -10, 3]); v.a_zw = Math.PI / 2;
  var F = v.frame(), n = M4.col(F, 3);
  assert(S.gallery.sdf(v.cam) > v.cameraRadius, 'safe rotated tutorial camera');
  vectorNear(n, [0, 0, -1, 0], 1e-15, 'zw quarter-turn really selects z=-10');
  var direction = M4.normalize(M4.mulVec(F, [1.15, 0, 3, 0]));
  var hit = S.gallery.raycast(v.cam, direction);
  assert(hit && hit.object.id === 'spheritorus', 'tilted torus is not occluded by another exhibit');
});

test('F01/F02 real buttons control actual matrices and all four panels, not just slider values', function () {
  var b = browser(), env = b.env, n = b.nodes, time = 0, matrices = [], materials = [];
  function frame(count) { for (var i = 0; i < count; i++) env.tick(time += 50); }
  function select(name) { b.tabs.find(function (t) { return t.dataset.view === name; }).emit('click'); }
  var draw = env.ProjectionView.prototype.draw;
  env.ProjectionView.prototype.draw = function () { matrices.push(this.rotor()); draw.call(this); };
  select('projection'); frame(60); n['proj-iso'].emit('click'); frame(1);
  var A = matrices[matrices.length - 1]; frame(10); var B = matrices[matrices.length - 1];
  for (var i = 0; i < 4; i++) near(M4.dot(M4.col(A, i), M4.col(B, i)), Math.cos(0.2), 2e-13, 'actual isoclinic increment');
  ['cubeVertices', 'tesseractVertices'].forEach(function (name) {
    var fn = env.AnalogyView.prototype[name];
    env.AnalogyView.prototype[name] = function () { var points = fn.call(this); materials.push(points); return points; };
  });
  select('analogy'); frame(5);
  n.spin.checked = false; n.spin.emit('change');
  n.autok.checked = false; n.autok.emit('change');
  n.kslider.value = '0.2'; n.kslider.emit('input');
  materials = []; frame(1); var before = JSON.stringify(materials);
  materials = []; frame(1);
  assert(materials.length === 4 && JSON.stringify(materials) === before, 'four fixed material coordinate sets');
  n.autok.checked = true; n.autok.emit('change');
  var kValues = [], step = env.AnalogyView.prototype.step;
  env.AnalogyView.prototype.step = function (dt) { step.call(this, dt); kValues.push(this.k); };
  materials = []; frame(1);
  assert(JSON.stringify(materials) === before, 'scan must not rotate any panel');
  frame(2); assert(kValues[0] !== kValues[2], 'auto k is independent');
  assert(b.errors.length === 0, 'controls remain operational');
});

test('F04 tutorial button puts the red ball inside the actual default frustum and Q/E sweeps it', function () {
  var b = browser(), env = b.env, n = b.nodes, time = 0;
  b.tabs.find(function (t) { return t.dataset.view === 'slice'; }).emit('click');
  env.document.activeElement = n['slice-glome'];
  n['slice-glome'].emit('click'); env.tick(time += 50);
  assert(env.document.activeElement === null, 'preset releases button focus so Q/E are not swallowed');
  var u = n['cv-slice'].gl.uniforms, ball = S.gallery.objects.find(function (o) { return o.id === 'glome'; });
  assert(!n.wtint.checked && !n.xray.checked, 'red material, not a ghost or tint');
  [0, 1, -1].forEach(function (w) {
    n.wslider.value = String(w); n.wslider.emit('input'); env.tick(time += 50);
    var to = M4.sub(ball.center, u.uCam);
    var x = M4.dot(to, u.uAx), y = M4.dot(to, u.uAy), z = M4.dot(to, u.uAz);
    [320 / 420, 390 / 420, 965 / 738].forEach(function (aspect) {
      var angularRadius = Math.asin(Math.sqrt(ball.params.r * ball.params.r - w * w) / z);
      assert(z > 0 && Math.abs(Math.atan2(x, z)) + angularRadius < Math.atan(aspect / (2 * u.uFocal)),
        'entire red cross-section fits horizontal frustum');
      assert(Math.abs(Math.atan2(y, z)) + angularRadius < Math.atan(1 / (2 * u.uFocal)),
        'entire red cross-section fits vertical frustum');
    });
    var hit = S.gallery.raycast(u.uCam, u.uAz);
    assert(hit && hit.object.id === 'glome', 'visible center ray hits red sphere before any occluder');
  });
  n['slice-glome'].emit('click');
  env.emit('keydown', { code: 'KeyE', target: { tagName: 'BODY' }, preventDefault: function () {} });
  for (var i = 0; i < 6; i++) env.tick(time += 50);
  env.emit('keyup', { code: 'KeyE' });
  assert(u.uCam[3] > ball.params.r, 'actual E key leaves the sphere');
  var hit = S.gallery.raycast(u.uCam, u.uAz);
  assert(!hit || hit.object.id !== 'glome', 'sphere disappears from the view');
  assert(b.errors.length === 0, 'tutorial no errors');
});

test('F16/F03 runtime failures are isolated and explicit resets resume physics and camera updates', function () {
  var b = browser(), env = b.env, n = b.nodes, time = 0;
  function select(name) { b.tabs.find(function (t) { return t.dataset.view === name; }).emit('click'); }
  function frame() { env.tick(time += 50); }
  select('physics');
  var step = env.Physics4.World4.prototype.step, steps = 0;
  env.Physics4.World4.prototype.step = function () { throw new Error('injected convergence failure'); };
  frame();
  assert(n.fatal.style.display === 'block', 'failure is visible');
  env.Physics4.World4.prototype.step = function (dt, budget) { steps++; return step.call(this, dt, budget); };
  frame(); assert(steps === 0, 'failed physics stays stopped until explicit reset');
  select('projection'); frame(); assert(n.fatal.style.display === 'none', 'other tab remains usable');
  select('physics'); assert(n.fatal.style.display === 'block', 'error stays on affected tab');
  n['physics-reset'].emit('click'); frame();
  assert(steps > 0 && n.fatal.style.display === 'none', 'scene reset clears error and resumes');
  select('slice');
  var move = env.SliceView.prototype.moveCamera;
  env.SliceView.prototype.moveCamera = function () { throw new Error('injected camera failure'); };
  env.emit('keydown', { code: 'KeyW', target: { tagName: 'BODY' }, preventDefault: function () {} });
  frame(); assert(n.fatal.style.display === 'block', 'camera failure is visible');
  env.SliceView.prototype.moveCamera = move;
  n['slice-reset'].emit('click'); frame();
  assert(n.fatal.style.display === 'none', 'camera reset recovers');
  env.emit('keydown', { code: 'KeyW', target: { tagName: 'BODY' }, preventDefault: function () {} });
  frame(); assert(n['cv-slice'].gl.uniforms.uCam[2] < 0, 'movement resumes after reset');
  assert(b.errors.length === 2, 'only explicitly injected errors');
});

test('F16 solver degradation keeps real app frames, camera and reset alive without fatal errors', function () {
  var b = browser(), env = b.env, n = b.nodes, time = 0, view, calls = 0;
  var draw = env.PhysicsView.prototype.draw, solve = env.Collide4.solveWorld;
  env.PhysicsView.prototype.draw = function () { view = this; return draw.call(this); };
  env.Collide4.solveWorld = function () {
    calls++;
    throw new env.Physics4.ContactConvergenceError(0.01);
  };
  b.tabs.find(function (t) { return t.dataset.view === 'physics'; }).emit('click');
  env.tick(time += 50);
  assert(view.skippedFrames === 1 && view.world.skippedSteps === 1, 'one skipped frame, no catch-up loop');
  assert(!view.error && n.fatal.style.display === 'none', 'convergence is not fatal');
  assert(n['physics-status'].textContent.includes('该步已回滚') && n.hud.innerHTML.includes('已跳过 1 帧'),
    'honest visible warning and counter');
  var before = JSON.stringify(view.world.bodies), cam = view.cam.slice(), firstCalls = calls;
  env.emit('keydown', { code: 'KeyE', target: { tagName: 'BODY' }, preventDefault: function () {} });
  env.tick(time += 50);
  assert(view.skippedFrames === 2 && calls === firstCalls, 'identical failed input does not burn budget again');
  assert(JSON.stringify(view.world.bodies) === before && view.cam[3] > cam[3], 'physics rolled back, camera still moves');
  assert(n['physics-status'].textContent.includes('仍未推进'), 'repeated failure is not called progress');
  n['physics-friction'].value = '1.5'; n['physics-friction'].emit('input');
  env.tick(time += 50);
  assert(calls > firstCalls, 'changed parameter invalidates failed-state cache');
  env.Collide4.solveWorld = solve;
  env.tick(time += 50);
  assert(view.world.stepResult.advanced && n['physics-status'].textContent.includes('已恢复'),
    'later successful frame advances without reset');
  n['physics-reset'].emit('click');
  assert(!view.error && view.accumulator === 0 && view.skippedFrames === 0 && view.skippedTime === 0 &&
    view.solverWarning === '' && view.world.skippedSteps === 0 && !view.world._failedStep &&
    view.world.stepResult === null && !view.world._solverResult && view.world._collisionContacts.length === 0 &&
    n['physics-status'].textContent === '', 'reset removes all degradation and old contacts immediately');
  env.tick(time += 50);
  assert(!n.hud.innerHTML.includes('已跳过') && !view.error && b.errors.length === 0, 'reset resumes a clean app');
});

test('F16 all fixed steps in one display frame share one budget and skip the catch-up remainder', function () {
  var b = browser(), env = b.env, view, calls = 0;
  var draw = env.PhysicsView.prototype.draw;
  env.PhysicsView.prototype.draw = function () { view = this; return draw.call(this); };
  env.Collide4.solveWorld = function (w) { calls++; w._stepBudget.spend(160000); };
  b.tabs.find(function (t) { return t.dataset.view === 'physics'; }).emit('click');
  env.tick(50);
  assert(calls === 2 && view.skippedFrames === 1 && view.accumulator === 0, 'do not restart budget for each catch-up step');
  assert(view.world.stepResult.work <= env.Physics4.STEP_WORK_LIMIT, 'display frame obeys the shared ceiling');
  assert(!view.world._failedStep, 'partial frame budget must not disable the next full-budget attempt');
  env.tick(100);
  assert(calls === 4 && view.skippedFrames === 2 && !view.error && b.errors.length === 0,
    'next display frame really runs again');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;

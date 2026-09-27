'use strict';

global.window = global;
require('../js/m4.js');
require('../js/physics4.js');
require('../js/collide4.js');

var C = Collide4, P = Physics4, passed = 0, failed = 0, seed = 0x4d2026;
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
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function vector(n, amplitude) {
  return Array.from({ length: n }, function () { return amplitude * (2 * random() - 1); });
}
function rotation(three) {
  return M4.compose((three ? ['xy', 'xz', 'yz'] : M4.PLANES).map(function (plane) {
    return M4.rotation(plane, 6 * random());
  }));
}
function box(extra) {
  return new RigidBody4(Object.assign({
    halfSize: [0.3, 0.55, 0.8, 1.1].map(function (h) { return h * (0.6 + random()); }),
    position: vector(4, 1.5), orientation: rotation(), mass: 0.5 + 2 * random()
  }, extra));
}
function sphere(extra) { return new RigidBody4(Object.assign({ shape: 'glome', radius: 0.7 }, extra)); }
function moved(body, displacement) {
  return Object.assign({}, body, { position: M4.add(body.position, displacement) });
}
function norm(v) { return Math.sqrt(v.reduce(function (s, x) { return s + x * x; }, 0)); }
function energy(bodies) { return bodies.reduce(function (s, b) { return s + b.kineticEnergy(); }, 0); }
function momentum(bodies) {
  var linear = [0, 0, 0, 0], angular = [0, 0, 0, 0, 0, 0];
  bodies.forEach(function (body) {
    var p = M4.scale(body.velocity, body.mass), spin = body.worldAngularMomentum();
    var orbit = P.wedge(body.position, p);
    linear = M4.add(linear, p);
    angular = angular.map(function (x, i) { return x + spin[i] + orbit[i]; });
  });
  return { linear: linear, angular: angular };
}
function checkHit(hit) {
  assert(hit && hit.points.length > 0, 'nonempty manifold');
  near(norm(hit.normal), 1, 1e-12, 'unit normal');
  assert(Number.isFinite(hit.depth) && hit.depth >= 0, 'finite nonnegative depth');
  hit.points.forEach(function (p) { assert(p.length === 4 && p.every(Number.isFinite), 'finite contact'); });
}
function solvePair(a, b, restitution, friction) {
  var hit = C.collide(a, b);
  checkHit(hit);
  var contacts = C.pairContacts(a, b, hit, restitution);
  var result = P.solveContacts(contacts, friction, 1024);
  assert(result.change < 1e-11, 'contact solver convergence: ' + result.change);
  return contacts;
}

test('support maps, cross4 orthogonality and all 56 candidate axes', function () {
  for (var i = 0; i < 100; i++) {
    var a = box(), d = vector(4, 2), p = C.support(a, d);
    var maximum = Math.max.apply(null, C.vertices(a).map(function (v) { return M4.dot(v, d); }));
    near(M4.dot(p, d), maximum, 1e-12, 'box support');
    var s = sphere({ position: vector(4, 2), radius: 0.2 + random() });
    near(M4.dot(M4.sub(C.support(s, d), s.position), d), s.radius * norm(d), 1e-12, 'glome support');
    var u = vector(4, 1), v = vector(4, 1), w = vector(4, 1), n = C.cross4(u, v, w);
    [u, v, w].forEach(function (axis) { near(M4.dot(axis, n), 0, 1e-13, 'cross orthogonality'); });
    assert(C.satAxes(a, box()).length === 56, '56 axes before eliminating dependent triples');
  }
});

test('generic GJK uses support maps, not a SAT or shape-specific intersection fallback', function () {
  var vertices = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [-1, -1, -1, -1]];
  function convex(offset) {
    return { support: function (d) {
      var best = vertices[0];
      vertices.forEach(function (p) { if (M4.dot(p, d) > M4.dot(best, d)) best = p; });
      return M4.add(best, offset);
    } };
  }
  assert(C.gjk(convex([0, 0, 0, 0]), convex([0.1, -0.1, 0.2, 0.1])).intersects, 'overlapping 4-simplices');
  var result = C.gjk(convex([0, 0, 0, 0]), convex([4, 0, 0, 0]));
  assert(!result.intersects && result.distance > 2, 'separated 4-simplices');
  near(norm(M4.sub(result.pointA, result.pointB)), result.distance, 1e-12, 'barycentric witnesses');
  var threw = false;
  try { C.gjk({ support: function () { return [NaN, 0, 0, 0]; } }, convex([0, 0, 0, 0])); }
  catch (error) { threw = true; }
  assert(threw, 'invalid support explicitly rejected');
});

test('6000 random box pairs: GJK/SAT 100% agreement; MTV boundary independently checked by GJK', function () {
  var hits = 0, misses = 0, maxDistance = 0;
  for (var i = 0; i < 6000; i++) {
    var a = box(), b = box(), hit = C.sat(a, b), result = C.gjk(a, b);
    assert(!!hit === result.intersects, 'intersection mismatch case ' + i);
    if (!hit) {
      misses++;
      near(norm(M4.sub(result.pointA, result.pointB)), result.distance, 1e-11, 'closest witnesses');
      continue;
    }
    hits++;
    var margin = 2e-6;
    var boundary = C.gjk(a, moved(b, M4.scale(hit.normal, hit.depth)));
    assert(boundary.intersects, 'MTV reaches contact case ' + i);
    var outside = C.gjk(a, moved(b, M4.scale(hit.normal, hit.depth + margin)));
    assert(!outside.intersects, 'MTV plus margin separates case ' + i);
    near(outside.distance, margin, 2e-8, 'penetration depth via GJK distance after MTV');
    maxDistance = Math.max(maxDistance, Math.abs(outside.distance - margin));
    if (hit.depth > margin) {
      assert(C.gjk(a, moved(b, M4.scale(hit.normal, hit.depth - margin))).intersects,
        'MTV minus margin still intersects case ' + i);
    }
  }
  assert(hits > 800 && misses > 800, 'both classifications well represented: ' + hits + '/' + misses);
  console.log('  intersections=' + hits + ', separated=' + misses + ', MTV distance error=' + maxDistance.toExponential(3));
});

function surfaceGrid(body, subdivisions) {
  var points = [];
  for (var axis = 0; axis < 4; axis++) {
    [-1, 1].forEach(function (sign) {
      for (var i = 0; i <= subdivisions; i++) {
        for (var j = 0; j <= subdivisions; j++) {
          for (var k = 0; k <= subdivisions; k++) {
            var coordinates = [2 * i / subdivisions - 1, 2 * j / subdivisions - 1, 2 * k / subdivisions - 1];
            coordinates.splice(axis, 0, sign);
            var local = body.shape === 'glome' ? M4.scale(M4.normalize(coordinates), body.radius) :
              coordinates.map(function (x, n) { return x * body.halfSize[n]; });
            points.push(M4.add(body.position, M4.mulVec(body.orientation, local)));
          }
        }
      }
    });
  }
  return points;
}
function bruteDistance(A, B) {
  var best = Infinity;
  for (var i = 0; i < A.length; i++) {
    for (var j = 0; j < B.length; j++) {
      var d2 = 0;
      for (var k = 0; k < 4; k++) { var d = A[i][k] - B[j][k]; d2 += d * d; }
      best = Math.min(best, d2);
    }
  }
  return Math.sqrt(best);
}

test('dense surface brute force: box/box, glome/glome, glome/box distances and common SO(4) rotations', function () {
  // 8*(8+1)^3=5832 samples per shape, all 34,012,224 point pairs.
  // Chosen directions include the exact optimum in the grid, so no mesh-size tolerance is needed.
  [['box4', 'box4'], ['glome', 'glome'], ['glome', 'box4']].forEach(function (shapes) {
    var R = rotation(), offset = vector(4, 3);
    var a = new RigidBody4({ shape: shapes[0], halfSize: [0.5, 0.5, 0.5, 0.5], radius: 0.5,
      position: offset, orientation: R });
    var b = new RigidBody4({ shape: shapes[1], halfSize: [0.5, 0.5, 0.5, 0.5], radius: 0.5,
      position: M4.add(offset, M4.mulVec(R, [2, 0, 0, 0])), orientation: R });
    var sampled = bruteDistance(surfaceGrid(a, 8), surfaceGrid(b, 8));
    var g = C.gjk(a, b);
    assert(!g.intersects, 'separated sampled shapes');
    near(g.distance, sampled, 1e-9, shapes.join('/') + ' dense numerical minimum');
  });
});

// Independent box distance minimization in eight bounded local coordinates.
// Cyclic exact coordinate minimization of a convex quadratic does not use GJK simplices or SAT.
function numericalBoxDistance(a, b) {
  var columns = [], bounds = a.halfSize.concat(b.halfSize), x = new Array(8).fill(0);
  for (var i = 0; i < 4; i++) columns.push(M4.col(a.orientation, i));
  for (i = 0; i < 4; i++) columns.push(M4.scale(M4.col(b.orientation, i), -1));
  var residual = M4.sub(a.position, b.position);
  for (var pass = 0; pass < 20000; pass++) {
    for (i = 0; i < 8; i++) {
      var next = Math.max(-bounds[i], Math.min(bounds[i], x[i] - M4.dot(columns[i], residual)));
      residual = M4.add(residual, M4.scale(columns[i], next - x[i]));
      x[i] = next;
    }
    var gap = 0;
    for (i = 0; i < 8; i++) {
      var gradient = M4.dot(columns[i], residual);
      gap += gradient * x[i] + Math.abs(gradient) * bounds[i];
    }
    if (gap < 1e-13) return norm(residual);
  }
  throw new Error('Independent numerical minimizer did not converge');
}

test('100 randomly oriented separated boxes: GJK distance versus independent bounded numerical minimization', function () {
  var count = 0;
  while (count < 100) {
    var a = box(), b = box(), g = C.gjk(a, b);
    if (g.intersects) continue;
    near(g.distance, numericalBoxDistance(a, b), 2e-9, 'random numerical distance ' + count);
    count++;
  }
});

test('analytic glome contacts include external corners and centers inside boxes', function () {
  var a = sphere({ radius: 1 }), b = sphere({ radius: 0.5, position: [1.2, 0, 0, 0] });
  var hit = C.collide(a, b);
  checkHit(hit);
  near(hit.depth, 0.3, 1e-14, 'sphere depth');
  vectorNear(hit.normal, [1, 0, 0, 0], 1e-14, 'A towards B');
  var cube = new RigidBody4({ halfSize: [1, 1, 1, 1] });
  var corner = sphere({ radius: 1, position: [1.3, 1.4, 1, 1] });
  hit = C.collide(corner, cube);
  near(hit.depth, 0.5, 1e-14, 'corner distance');
  vectorNear(hit.normal, [-0.6, -0.8, 0, 0], 1e-14, 'corner normal');
  var inside = sphere({ radius: 0.2, position: [0.8, 0, 0, 0] });
  hit = C.collide(inside, cube);
  near(hit.depth, 0.4, 1e-14, 'containment requires radius plus exit distance');
  vectorNear(hit.normal, [-1, 0, 0, 0], 0, 'negative normal pushes A out');
  assert(!C.collide(sphere({ position: [4, 0, 0, 0] }), cube), 'separated sphere/box');
});

test('300 random glome/box and glome/glome pairs: generic GJK versus analytic distances', function () {
  for (var i = 0; i < 300; i++) {
    var a = sphere({ position: vector(4, 2), radius: 0.2 + random() });
    var b = i % 2 ? box() : sphere({ position: vector(4, 2), radius: 0.2 + random() });
    var expected;
    if (b.shape === 'glome') expected = Math.max(0, norm(M4.sub(a.position, b.position)) - a.radius - b.radius);
    else {
      var local = M4.mulVec(M4.transpose(b.orientation), M4.sub(a.position, b.position));
      var outside = local.map(function (x, axis) { return Math.max(0, Math.abs(x) - b.halfSize[axis]); });
      expected = Math.max(0, norm(outside) - a.radius);
    }
    var g = C.gjk(a, b);
    assert(g.intersects === (expected === 0), 'analytic classification ' + i);
    near(g.distance, expected, 2e-9, 'analytic distance ' + i);
  }
});

test('collide symmetry: reversed normals, equal depths and identical shared manifolds', function () {
  for (var i = 0; i < 300; i++) {
    var a = i % 3 ? box({ position: vector(4, 0.3) }) : sphere({ position: vector(4, 0.3) });
    var b = i % 2 ? box({ position: vector(4, 0.3) }) : sphere({ position: vector(4, 0.3) });
    var ab = C.collide(a, b), ba = C.collide(b, a);
    checkHit(ab); checkHit(ba);
    near(ab.depth, ba.depth, 0, 'symmetric depth');
    vectorNear(ab.normal, M4.scale(ba.normal, -1), 0, 'opposite normal');
    assert(JSON.stringify(ab.points) === JSON.stringify(ba.points), 'same shared points');
  }
});

test('coincident, vertex-only, edge-only, parallel-cell, thin and extreme-aspect contacts remain finite', function () {
  var cube = new RigidBody4({ halfSize: [1, 1, 1, 1] });
  [[0, 0, 0, 0], [2, 2, 2, 2], [2, 2, 2, 0], [0, 2, 0, 0]].forEach(function (p) {
    var b = new RigidBody4({ halfSize: [1, 1, 1, 1], position: p });
    checkHit(C.collide(cube, b));
    assert(C.gjk(cube, b).intersects, 'degenerate GJK contact');
  });
  checkHit(C.collide(sphere(), sphere()));
  checkHit(C.collide(sphere(), cube));
  [0, 1e-9, 0.1].forEach(function (angle) {
    var a = box({ halfSize: [1e-4, 1e-2, 10, 100], position: [0, 0, 0, 0], orientation: M4.ident() });
    var b = box({ halfSize: a.halfSize, position: [0, 0, 0, 0], orientation: M4.rotation('xw', angle) });
    checkHit(C.collide(a, b));
    assert(C.gjk(a, b).intersects, 'extreme aspect intersection');
    b.position[0] = 30;
    assert(!C.sat(a, b) && !C.gjk(a, b).intersects, 'extreme aspect separation');
  });
});

test('box contact manifold includes a full support cell and a feature-only intersection', function () {
  var a = new RigidBody4({ halfSize: [1, 1, 1, 1] });
  var b = new RigidBody4({ halfSize: [1, 1, 1, 1], position: [0, 1.9, 0, 0] });
  var hit = C.collide(a, b);
  assert(hit.points.length >= 8, 'all eight vertices of the contact 3-cell');
  hit.points.forEach(function (p) { near(p[1], 0.95, 1e-12, 'common median contact plane'); });
  a = new RigidBody4({ halfSize: [2, 0.2, 0.2, 0.2] });
  b = new RigidBody4({ halfSize: [0.2, 2, 0.2, 0.2], position: [0, 0, 0.3, 0] });
  hit = C.collide(a, b);
  checkHit(hit);
  assert(hit.points.length >= 1, 'crossed thin boxes need support-feature fallback');
});

function sat3(a, b) {
  function cross(u, v) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0], 0]; }
  var A = [0, 1, 2].map(function (i) { return M4.col(a.orientation, i); });
  var B = [0, 1, 2].map(function (i) { return M4.col(b.orientation, i); });
  var axes = A.concat(B);
  A.forEach(function (u) { B.forEach(function (v) { axes.push(cross(u, v)); }); });
  return axes.every(function (n) {
    if (norm(n) < 1e-12) return true;
    var extent = 0;
    for (var i = 0; i < 3; i++) extent += a.halfSize[i] * Math.abs(M4.dot(A[i], n)) +
      b.halfSize[i] * Math.abs(M4.dot(B[i], n));
    return Math.abs(M4.dot(M4.sub(a.position, b.position), n)) <= extent + 1e-10;
  });
}

test('1000 w=0 pairs reduce to independent 3D 15-axis SAT', function () {
  for (var i = 0; i < 1000; i++) {
    var a = box({ orientation: rotation(true) }), b = box({ orientation: rotation(true) });
    [a, b].forEach(function (body) { body.halfSize[3] = 0; body.position[3] = 0; });
    var expected = sat3(a, b);
    assert(!!C.sat(a, b) === expected, '3D SAT mismatch ' + i);
    assert(C.gjk(a, b).intersects === expected, '3D GJK mismatch ' + i);
  }
});

test('off-center pair impulses conserve linear and all SIX fixed-origin angular momentum components', function () {
  var exchanged = 0, maxLinear = 0, maxAngular = 0;
  for (var i = 0; i < 100; i++) {
    var a = box({ position: [1.8, -0.3, 0.7, 1.2], velocity: vector(4, 2), angularVelocity: vector(6, 1) });
    var b = box({ position: [2.1, -0.1, 0.9, 1.1], velocity: vector(4, 2), angularVelocity: vector(6, 1) });
    var initial = momentum([a, b]), va = a.velocity.slice(), vb = b.velocity.slice(), before = energy([a, b]);
    solvePair(a, b, 0.4, 0.5);
    var final = momentum([a, b]);
    assert(energy([a, b]) <= before + 2e-10, 'frictional impact energy gain');
    vectorNear(final.linear, initial.linear, 2e-11, 'linear momentum');
    vectorNear(final.angular, initial.angular, 2e-11, 'spin + position wedge momentum');
    maxLinear = Math.max(maxLinear, norm(M4.sub(final.linear, initial.linear)));
    maxAngular = Math.max(maxAngular, norm(final.angular.map(function (x, k) { return x - initial.angular[k]; })));
    var ja = M4.scale(M4.sub(a.velocity, va), a.mass), jb = M4.scale(M4.sub(b.velocity, vb), b.mass);
    vectorNear(ja, M4.scale(jb, -1), 2e-11, 'Newton third law');
    exchanged += norm(ja);
  }
  assert(exchanged > 10, 'must exchange real impulses, not skip collisions');
  console.log('  max |delta P|=' + maxLinear.toExponential(3) + ', max |delta L|=' + maxAngular.toExponential(3));
});

test('frictionless restitution: elastic kinetic energy equality, inelastic energy never increases', function () {
  var maxElasticError = 0;
  [0, 0.3, 0.8, 1].forEach(function (e) {
    for (var i = 0; i < 60; i++) {
      var a = box({ position: vector(4, 0.15), velocity: vector(4, 2), angularVelocity: vector(6, 0.8) });
      var b = box({ position: vector(4, 0.15), velocity: vector(4, 2), angularVelocity: vector(6, 0.8) });
      var before = energy([a, b]);
      solvePair(a, b, e, 0);
      if (e === 1) {
        near(energy([a, b]), before, 2e-10, 'elastic energy');
        maxElasticError = Math.max(maxElasticError, Math.abs(energy([a, b]) - before));
      }
      else assert(energy([a, b]) <= before + 2e-10, 'inelastic energy gain');
    }
  });
  console.log('  max elastic |delta E|=' + maxElasticError.toExponential(3));
});

test('glome head-on collision matches two-mass analytic velocities and preserves energy', function () {
  var a = sphere({ mass: 2, radius: 1, position: [-1, 0, 0, 0], velocity: [3, 0, 0, 0] });
  var b = sphere({ mass: 3, radius: 1, position: [1, 0, 0, 0], velocity: [-1, 0, 0, 0] });
  var before = energy([a, b]);
  solvePair(a, b, 1, 0);
  near(a.velocity[0], -1.8, 1e-13, 'mass 2 velocity');
  near(b.velocity[0], 2.2, 1e-13, 'mass 3 velocity');
  near(energy([a, b]), before, 1e-12, 'analytic energy');
});

test('four-dimensional tangential friction has equal opposite impulses and obeys its Coulomb ball', function () {
  var a = sphere({ position: [-0.7, 0, 0, 0], velocity: [2, 3, -4, 5] });
  var b = sphere({ position: [0.7, 0, 0, 0], velocity: [-2, -1, 2, -3] });
  var before = energy([a, b]), initial = momentum([a, b]);
  var contacts = solvePair(a, b, 0, 0.2);
  assert(energy([a, b]) < before, 'friction dissipates energy');
  assert(Math.abs(a.velocity[3]) < 5, 'friction acts along w');
  contacts.forEach(function (c) {
    near(M4.dot(c.tangentImpulse, c.normal), 0, 1e-12, 'tangent in 3D hyperplane');
    assert(norm(c.tangentImpulse) <= 0.2 * (c.normalImpulse + c.impactImpulse) + 1e-12, 'Coulomb limit');
  });
  vectorNear(momentum([a, b]).angular, initial.angular, 1e-12, 'friction angular conservation');
});

test('World4 collision wiring: no-floor two-body elastic impact, external force accounting', function () {
  var world = new P.World4({ gravity: 0, floor: false, restitution: 1, friction: 0 });
  var a = sphere({ position: [-2, 0.3, 0.7, 1.1], velocity: [2, 0, 0, 0] });
  var b = sphere({ position: [2, 0.3, 0.7, 1.1], velocity: [-2, 0, 0, 0] });
  world.bodies.push(a, b);
  var initial = momentum(world.bodies), before = energy(world.bodies);
  for (var i = 0; i < 480; i++) world.step(1 / 240);
  assert(a.velocity[0] < 0 && b.velocity[0] > 0, 'must bounce through World4.step');
  vectorNear(momentum(world.bodies).linear, initial.linear, 1e-11, 'world linear');
  vectorNear(momentum(world.bodies).angular, initial.angular, 1e-11, 'world angular');
  near(energy(world.bodies), before, 1e-11, 'world energy');
  a.applyForce([1, 2, 3, 4]);
  var p0 = momentum(world.bodies).linear;
  world.step(0.01);
  vectorNear(momentum(world.bodies).linear, M4.add(p0, [0.01, 0.02, 0.03, 0.04]), 1e-11, 'force applied once');
});

test('200 seeded random two-body worlds over 3 seconds: finite, bounded, no residual penetration or energy gain', function () {
  var impacts = 0, worstDepth = 0, worstEnergy = 0;
  for (var trial = 0; trial < 200; trial++) {
    var world = new P.World4({ gravity: 0, floor: false, restitution: (trial % 4) * 0.2, friction: 0.4 });
    var direction = M4.normalize(vector(4, 1)), origin = vector(4, 1);
    function body(sign, glome) {
      var options = { position: M4.add(origin, M4.scale(direction, sign * 2.4)),
        velocity: M4.scale(direction, -sign * (0.8 + random())), angularVelocity: vector(6, 0.3) };
      return glome ? sphere(options) : box(options);
    }
    world.bodies.push(body(-1, trial % 3 === 0), body(1, trial % 3 === 1));
    var before = energy(world.bodies), previous = before, touched = false;
    for (var step = 0; step < 720; step++) {
      world.step(1 / 240);
      var current = energy(world.bodies);
      worstEnergy = Math.max(worstEnergy, current - previous);
      assert(current <= previous + 1e-8, 'step energy increase trial ' + trial + ': ' + (current - previous));
      assert(current <= before + 1e-8, 'total energy increase');
      previous = current;
      world.bodies.forEach(function (b) {
        assert(b.position.concat(b.velocity, b.orientation, b.angularVelocity).every(Number.isFinite), 'nonfinite state');
        assert(norm(b.position) < 30 && norm(b.velocity) < 20 && norm(b.angularVelocity) < 50, 'numerical explosion');
      });
      var a = world.bodies[0], b = world.bodies[1];
      var hit = a.shape === 'box4' && b.shape === 'box4' ? C.sat(a, b) : C.collide(a, b);
      if (hit) {
        touched = true;
        worstDepth = Math.max(worstDepth, hit.depth);
        assert(hit.depth < 1e-8, 'residual penetration ' + hit.depth);
      }
    }
    if (touched) impacts++;
  }
  assert(impacts > 150, 'stress must include actual impacts: ' + impacts);
  console.log('  impacts=' + impacts + ', max depth=' + worstDepth.toExponential(3) +
    ', max step energy increase=' + worstEnergy.toExponential(3));
});

test('40 random four-body worlds over 2 seconds: coupled contacts, no penetration or energy growth', function () {
  var impacts = 0;
  for (var trial = 0; trial < 40; trial++) {
    var world = new P.World4({ gravity: 0, floor: false, restitution: trial % 2 ? 0.3 : 0, friction: 0.3 });
    var R = rotation();
    [[1, 0, 0, 0], [-1, 0, 0, 0], [0, 0, 1, 0], [0, 0, -1, 0]].forEach(function (axis, i) {
      var direction = M4.mulVec(R, axis);
      var options = { position: M4.scale(direction, 2.5),
        velocity: M4.scale(direction, -1.5 - 0.3 * random()), angularVelocity: vector(6, 0.2) };
      world.bodies.push(i === trial % 4 ? sphere(options) : box(options));
    });
    var previous = energy(world.bodies);
    for (var step = 0; step < 480; step++) {
      world.step(1 / 240);
      var current = energy(world.bodies);
      assert(Number.isFinite(current) && current <= previous + 1e-8, 'multibody step energy gain');
      previous = current;
      for (var i = 0; i < 4; i++) {
        var a = world.bodies[i];
        assert(a.position.concat(a.velocity, a.angularVelocity, a.orientation).every(Number.isFinite), 'finite multibody state');
        for (var j = i + 1; j < 4; j++) {
          var b = world.bodies[j];
          var hit = a.shape === 'box4' && b.shape === 'box4' ? C.sat(a, b) : C.collide(a, b);
          if (hit) { impacts++; assert(hit.depth < 1e-8, 'multibody residual depth ' + hit.depth); }
        }
      }
    }
  }
  assert(impacts > 100, 'real coupled impacts');
});

test('four-box stack settles for 8 seconds with coupled floor contacts, no sinking or jitter', function () {
  var world = new P.World4({ restitution: 0, friction: 0.7 });
  for (var i = 0; i < 4; i++) world.bodies.push(new RigidBody4({
    halfSize: [0.65, 0.5, 0.65, 0.65], position: [0, -1 + i, 0, 0]
  }));
  var initial = world.bodies.map(function (body) { return body.position.slice(); });
  var maxPosition = 0, maxVelocity = 0, maxOmega = 0, maxDepth = 0;
  var E0 = world.bodies.reduce(function (s, b) { return s + b.mass * world.gravity * (b.position[1] - world.floorY); }, 0);
  for (var step = 0; step < 1920; step++) {
    world.step(1 / 240);
    var E = energy(world.bodies) + world.bodies.reduce(function (s, b) {
      return s + b.mass * world.gravity * (b.position[1] - world.floorY);
    }, 0);
    assert(E <= E0 + 1e-8, 'stack manufactured mechanical energy step ' + step + ': ' + (E - E0));
    if (step > 240) world.bodies.forEach(function (body, i) {
      maxPosition = Math.max(maxPosition, norm(M4.sub(body.position, initial[i])));
      maxVelocity = Math.max(maxVelocity, norm(body.velocity));
      maxOmega = Math.max(maxOmega, norm(body.angularVelocity));
      vectorNear(body.position, initial[i], 1e-7, 'stack position');
      assert(norm(body.velocity) < 1e-7, 'stack linear jitter: ' + norm(body.velocity));
      assert(norm(body.angularVelocity) < 1e-7, 'stack angular jitter: ' + norm(body.angularVelocity));
      assert(P.floorContacts(body, world.floorY).depth < 1e-10, 'stack floor sinking');
      if (i > 0) {
        var hit = C.sat(world.bodies[i - 1], body);
        if (hit) maxDepth = Math.max(maxDepth, hit.depth);
        assert(!hit || hit.depth < 1e-8, 'stack pair sinking');
      }
    });
  }
  console.log('  stack max position drift=' + maxPosition.toExponential(3) + ', speed=' + maxVelocity.toExponential(3) +
    ', angular speed=' + maxOmega.toExponential(3) + ', depth=' + maxDepth.toExponential(3));
});

test('six-body demo, classic script order and rendering uniforms/SDF are wired without shader regressions', function () {
  require('../js/scene4.js');
  require('../js/view-slice.js');
  require('../js/view-physics.js');
  var html = require('fs').readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');
  assert(html.indexOf('src="js/physics4.js"') < html.indexOf('src="js/collide4.js"') &&
    html.indexOf('src="js/collide4.js"') < html.indexOf('src="js/view-physics.js"'), 'classic script order');
  assert(html.indexOf('src="js/scene4.js"') < html.indexOf('src="js/view-slice.js"'), 'shared SDF library before renderer');
  var sources = [], uploaded = {}, draws = 0, oldDocument = global.document;
  global.document = { addEventListener: function () {} };
  var gl = {
    getParameter: function () { return 128; }, createShader: function () { return {}; },
    shaderSource: function (_, source) { sources.push(source); }, compileShader: function () {},
    getShaderParameter: function () { return true; }, createProgram: function () { return {}; },
    attachShader: function () {}, linkProgram: function () {}, getProgramParameter: function () { return true; },
    useProgram: function () {}, createBuffer: function () { return {}; }, bindBuffer: function () {},
    bufferData: function () {}, getAttribLocation: function () { return 0; }, enableVertexAttribArray: function () {},
    vertexAttribPointer: function () {}, getUniformLocation: function (_, name) { return name; },
    uniformMatrix4fv: function (name, transpose, value) {
      assert(!transpose, 'WebGL matrix transpose must be false'); uploaded[name] = Array.from(value);
    },
    uniform4fv: function (name, value) { uploaded[name] = Array.from(value); },
    uniform1fv: function (name, value) { uploaded[name] = Array.from(value); },
    uniform1i: function (name, value) { uploaded[name] = value; },
    uniform1f: function (name, value) { uploaded[name] = value; },
    uniform2f: function () {}, viewport: function () {}, drawArrays: function () { draws++; }
  };
  try {
    var canvas = { getContext: function () { return gl; }, addEventListener: function () {}, width: 320, height: 240 };
    var view = new PhysicsView(canvas);
    assert(!view.error && view.world.bodies.length === 6, 'six visible bodies');
    sources.forEach(function (source) {
      assert(/^[\x00-\x7f]*$/.test(source), 'ASCII GLSL');
      assert(!/\?/.test(source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
        'no GLSL ternary, including vector ternary');
    });
    [0, 0.45].forEach(function (restitution) {
      view.world.restitution = restitution;
      view.resetScene();
      for (var step = 0; step < 1440; step++) view.world.step(1 / 240);
      view.draw();
      assert(uploaded.uCount === 6, 'upload count matches active bodies');
      view.world.bodies.forEach(function (body, i) {
        vectorNear(uploaded['uBodyPos[0]'].slice(i * 4, i * 4 + 4), body.position, 1e-6, 'position uniform');
        vectorNear(uploaded['uInvR[0]'].slice(i * 16, i * 16 + 16), body.orientation, 1e-7, 'inverse R upload');
      });
    });
    assert(draws === 2, 'draw actual shared SliceView path');
    gl.getParameter = function () { return 26; };
    var small = new PhysicsView(canvas);
    assert(small.maxBodies === 2 && small.world.bodies.length === 2, 'low uniform capacity is respected');
    small.draw();
  } finally {
    global.document = oldDocument;
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

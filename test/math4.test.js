'use strict';

global.window = global;
require('../js/m4.js');
require('../js/physics4.js');

var P = Physics4, passed = 0, failed = 0;
var initialSeed = process.env.MATH4_SEED === undefined ? 0x4d202609 : Number(process.env.MATH4_SEED);
if (!Number.isInteger(initialSeed) || initialSeed < 0 || initialSeed > 0xffffffff) {
  throw new Error('MATH4_SEED must be a uint32');
}
var seed = initialSeed, maxError = 0, maxBudget = 0, assertions = 0;
var totalAssertions = 0, sampleCount = 4096;
var reconstructionError = 0, normalFormError = 0;
function assert(ok, message) {
  assertions++;
  if (!ok) throw new Error(message);
}
function near(a, b, eps, message) {
  var error = Math.abs(a - b);
  maxError = Math.max(maxError, error);
  if (eps > 0) maxBudget = Math.max(maxBudget, error / eps);
  assert(Number.isFinite(a) && Number.isFinite(b) && error <= eps,
    message + ': ' + a + ' vs ' + b + ' (limit ' + eps + ')');
}
function vectorNear(a, b, eps, message) {
  assert(a.length === b.length, message + ' dimension');
  a.forEach(function (x, i) { near(x, b[i], eps, message + '[' + i + ']'); });
}
function test(name, run) {
  seed = initialSeed;
  maxError = 0; maxBudget = 0; assertions = 0;
  try {
    run(); passed++;
    console.log('PASS ' + name + ' | checks=' + assertions +
      ' maxAbs=' + maxError.toExponential(3) + ' maxBudget=' + maxBudget.toFixed(3));
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + '\n' + error.stack);
  }
  totalAssertions += assertions;
}
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed + 0.5) / 4294967296;
}
function vector(n) { return Array.from({ length: n }, function () { return 2 * random() - 1; }); }
function dot(a, b) { return a.reduce(function (s, x, i) { return s + x * b[i]; }, 0); }
function norm(a) { return Math.sqrt(dot(a, a)); }
function scale(a, s) { return a.map(function (x) { return x * s; }); }
function add(a, b) { return a.map(function (x, i) { return x + b[i]; }); }
function sub(a, b) { return add(a, scale(b, -1)); }
function unit(a) {
  var n = norm(a);
  assert(n > 0, 'nonzero normalization input');
  return scale(a, 1 / n);
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function gaussian() { return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random()); }
function sphere(n) { return unit(Array.from({ length: n }, gaussian)); }
var basis = M4.ident().reduce(function (out, x, i) {
  if (i % 4 === 0) out.push([]);
  out[out.length - 1].push(x);
  return out;
}, []);
var I = [0, 1, 0, 0], J = [0, 0, 1, 0], K = [0, 0, 0, 1], ONE = [1, 0, 0, 0];
function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ];
}
function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
function su2(q) { return [[q[0], q[1]], [q[2], q[3]], [-q[2], q[3]], [q[0], -q[1]]]; }
function complexMatrixProduct(a, b) {
  return [0, 1, 2, 3].map(function (index) {
    var r = Math.floor(index / 2), c = index % 2;
    return add(cmul(a[2 * r], b[c]), cmul(a[2 * r + 1], b[c + 2]));
  });
}
function conj(q) { return [q[0], -q[1], -q[2], -q[3]]; }
function pure(a) { return [0].concat(a); }
function act(l, r, q) { return qmul(qmul(l, q), conj(r)); }
function matrixOf(fn) {
  var columns = basis.map(fn);
  return Array.from({ length: 16 }, function (_, i) { return columns[i % 4][Math.floor(i / 4)]; });
}
function spin(l, r) { return matrixOf(function (q) { return act(l, r, q); }); }
function adj(q, a) { return qmul(qmul(q, pure(a)), conj(q)).slice(1); }
function expPure(a) {
  var n = norm(a);
  if (n === 0) return ONE.slice();
  return [Math.cos(n)].concat(scale(a, Math.sin(n) / n));
}
function determinant(a, n) {
  if (n === 1) return a[0];
  var sum = 0;
  for (var c = 0; c < n; c++) {
    var minor = [];
    for (var i = 1; i < n; i++) {
      for (var j = 0; j < n; j++) if (j !== c) minor.push(a[i * n + j]);
    }
    sum += (c % 2 ? -1 : 1) * a[c] * determinant(minor, n - 1);
  }
  return sum;
}
function trace(a) { return a[0] + a[5] + a[10] + a[15]; }
function gram(vectors) {
  return vectors.reduce(function (out, a) {
    return out.concat(vectors.map(function (b) { return dot(a, b); }));
  }, []);
}
function rank(rows, eps) {
  var a = rows.map(function (row) { return row.slice(); }), r = 0;
  for (var c = 0; c < a[0].length && r < a.length; c++) {
    var pivot = r;
    for (var i = r + 1; i < a.length; i++) if (Math.abs(a[i][c]) > Math.abs(a[pivot][c])) pivot = i;
    if (Math.abs(a[pivot][c]) <= eps) continue;
    var tmp = a[r]; a[r] = a[pivot]; a[pivot] = tmp;
    var d = a[r][c];
    for (var j = c; j < a[r].length; j++) a[r][j] /= d;
    for (i = r + 1; i < a.length; i++) {
      var f = a[i][c];
      for (j = c; j < a[i].length; j++) a[i][j] -= f * a[r][j];
    }
    r++;
  }
  return r;
}

// Gaussian Householder QR, not quaternion-generated rotations or M4.orthonormalize.
function randomSO4() {
  var a = Array.from({ length: 16 }, gaussian), q = M4.ident();
  for (var k = 0; k < 4; k++) {
    var v = [0, 0, 0, 0];
    for (var i = k; i < 4; i++) v[i] = a[i * 4 + k];
    var alpha = (v[k] < 0 ? 1 : -1) * norm(v);
    v[k] -= alpha;
    v = unit(v);
    for (var c = k; c < 4; c++) {
      var s = 0;
      for (i = k; i < 4; i++) s += v[i] * a[i * 4 + c];
      for (i = k; i < 4; i++) a[i * 4 + c] -= 2 * v[i] * s;
    }
    for (var r = 0; r < 4; r++) {
      s = 0;
      for (i = k; i < 4; i++) s += q[r * 4 + i] * v[i];
      for (i = k; i < 4; i++) q[r * 4 + i] -= 2 * s * v[i];
    }
  }
  for (c = 0; c < 4; c++) {
    if (a[c * 4 + c] < 0) for (r = 0; r < 4; r++) q[r * 4 + c] *= -1;
  }
  if (determinant(q, 4) < 0) for (r = 0; r < 4; r++) q[r * 4 + 3] *= -1;
  return q;
}
var rotations = [];
var spinBasis = basis.reduce(function (out, l) {
  return out.concat(basis.map(function (r) { return spin(l, r); }));
}, []);
function associate(R) { return spinBasis.map(function (E) { return dot(R, E) / 4; }); }
function recover(R, pivot) {
  var A = associate(R), rowNorms = [0, 1, 2, 3].map(function (i) { return norm(A.slice(4 * i, 4 * i + 4)); });
  if (pivot === undefined) pivot = rowNorms.indexOf(Math.max.apply(null, rowNorms));
  var r = unit(A.slice(4 * pivot, 4 * pivot + 4));
  var l = [0, 1, 2, 3].map(function (i) { return dot(A.slice(4 * i, 4 * i + 4), r); });
  return { l: l, r: r, A: A, rowNorms: rowNorms };
}
function liftDistance(a, b) {
  return Math.min(norm(sub(a.l.concat(a.r), b.l.concat(b.r))),
    norm(add(a.l.concat(a.r), b.l.concat(b.r))));
}
function star(b) { return [b[5], -b[4], b[3], b[2], -b[1], b[0]]; }
function split(b) {
  return {
    a: [(b[0] + b[5]) / 2, (b[1] - b[4]) / 2, (b[2] + b[3]) / 2],
    b: [(b[5] - b[0]) / 2, -(b[1] + b[4]) / 2, (b[3] - b[2]) / 2]
  };
}
function join(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[2] + b[2], -a[1] - b[1], a[0] + b[0]]; }
function pfaffian(b) { return b[0] * b[5] - b[1] * b[4] + b[2] * b[3]; }
var pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
function epsilon(indices) {
  if (new Set(indices).size !== indices.length) return 0;
  var s = 1;
  for (var i = 0; i < indices.length; i++) for (var j = i + 1; j < indices.length; j++) {
    if (indices[i] > indices[j]) s *= -1;
  }
  return s;
}
function exterior4(a, b) {
  var sum = 0;
  pairs.forEach(function (ij, i) {
    pairs.forEach(function (kl, j) { sum += epsilon(ij.concat(kl)) * a[i] * b[j]; });
  });
  return sum;
}
function exteriorTransform(b, R) {
  return pairs.map(function (ij) {
    return pairs.reduce(function (sum, kl, k) {
      return sum + b[k] * (R[4 * ij[0] + kl[0]] * R[4 * ij[1] + kl[1]] -
        R[4 * ij[0] + kl[1]] * R[4 * ij[1] + kl[0]]);
    }, 0);
  });
}
function stereo(q, pole) { return scale(q.slice(0, 3), 1 / (1 - pole * q[3])); }
function unstereo(u, pole) {
  var s = dot(u, u);
  return scale(u, 2 / (1 + s)).concat(pole * (s - 1) / (s + 1));
}
function dstereo(q, v, pole) {
  var d = 1 - pole * q[3];
  return q.slice(0, 3).map(function (x, i) { return v[i] / d + pole * x * v[3] / (d * d); });
}
function inverseColumns(u, pole) {
  var d = 1 + dot(u, u);
  return [0, 1, 2].map(function (j) {
    return u.map(function (x, i) { return (i === j ? 2 / d : 0) - 4 * x * u[j] / (d * d); })
      .concat(4 * pole * u[j] / (d * d));
  });
}
function frame(q) { return [I, J, K].map(function (e) { return qmul(q, e); }); }
function hopf(q) { return qmul(qmul(q, I), conj(q)).slice(1); }
function dhopf(q, v) { return add(qmul(qmul(v, I), conj(q)), qmul(qmul(q, I), conj(v))).slice(1); }
function section(n, north) {
  if (north) return scale([1 + n[0], 0, -n[2], n[1]], 1 / Math.sqrt(2 * (1 + n[0])));
  return scale([-n[2], n[1], 1 - n[0], 0], 1 / Math.sqrt(2 * (1 - n[0])));
}
function torus(eta, u, v) {
  return [Math.cos(eta) * Math.cos(u), Math.cos(eta) * Math.sin(u),
    Math.sin(eta) * Math.cos(v), Math.sin(eta) * Math.sin(v)];
}

console.log('math4 seed=' + initialSeed + ' QR samples=' + sampleCount);

test('01 quaternion algebra, norm, inverse and multiplication stabilizer', function () {
  for (var k = 0; k < 2048; k++) {
    var a = vector(4), b = vector(4), c = vector(4);
    vectorNear(qmul(qmul(a, b), c), qmul(a, qmul(b, c)), 4e-15, 'associativity');
    near(dot(qmul(a, b), qmul(a, b)), dot(a, a) * dot(b, b), 8e-15, 'multiplicative squared norm');
    vectorNear(qmul(a, scale(conj(a), 1 / dot(a, a))), ONE, 7e-16, 'inverse');
    vectorNear(complexMatrixProduct(su2(a), su2(b)).flat(), su2(qmul(a, b)).flat(), 9e-16,
      'independent complex 2x2 matrix multiplication');
    var U = su2(a), complexDet = sub(cmul(U[0], U[3]), cmul(U[1], U[2]));
    vectorNear(complexDet, [dot(a, a), 0], 9e-16, 'quaternion norm is complex determinant');
    var s = sphere(4), R = spin(s, s);
    U = su2(s);
    var dagger = [U[0], U[2], U[1], U[3]].map(function (z) { return [z[0], -z[1]]; });
    vectorNear(complexMatrixProduct(dagger, U).flat(), [1, 0, 0, 0, 0, 0, 1, 0], 9e-16, 'unit quaternions are SU(2)');
    vectorNear(M4.mulVec(R, qmul(a, b)), qmul(M4.mulVec(R, a), M4.mulVec(R, b)), 5e-15, 'stabilizer is an automorphism');
    var product = qmul(a, b);
    vectorNear(qmul(scale(a, -1), scale(b, -1)), product, 0, '-I does not preserve multiplication');
    assert(norm(sub(product, scale(product, -1))) > 1e-8, 'explicit failure of full SO(4) algebra invariance');
  }
});

test('02 independent SO(4) QR samples, rank-one associate and lift uniqueness modulo sign', function () {
  spinBasis.forEach(function (a, i) {
    spinBasis.forEach(function (b, j) { near(dot(a, b), i === j ? 4 : 0, 0, 'orthogonal matrix basis'); });
  });
  for (var k = 0; k < sampleCount; k++) {
    var R = randomSO4(); rotations.push(R);
    vectorNear(M4.mul(M4.transpose(R), R), M4.ident(), 4e-15, 'QR orthogonality');
    near(determinant(R, 4), 1, 5e-15, 'QR determinant');
    var d = recover(R);
    near(norm(d.l), 1, 3e-15, 'left unit');
    near(norm(d.r), 1, 4e-16, 'right unit');
    var rebuilt = spin(d.l, d.r);
    reconstructionError = Math.max(reconstructionError, Math.max.apply(null, sub(rebuilt, R).map(Math.abs)));
    vectorNear(rebuilt, R, 3e-15, 'reconstruction from unrelated matrix');
    vectorNear(spin(scale(d.l, -1), scale(d.r, -1)), R, 3e-15, 'simultaneous sign');
    vectorNear(d.A, d.l.reduce(function (out, x) { return out.concat(scale(d.r, x)); }, []), 1e-15, 'rank-one entries');
    for (var i = 0; i < 4; i++) {
      for (var j = i + 1; j < 4; j++) for (var m = 0; m < 4; m++) for (var n = m + 1; n < 4; n++) {
        near(d.A[4 * i + m] * d.A[4 * j + n] - d.A[4 * i + n] * d.A[4 * j + m], 0, 7e-16, 'all 2x2 minors');
      }
      if (d.rowNorms[i] > 0.2) near(liftDistance(d, recover(R, i)), 0, 4e-15, 'independent pivot, same lift class');
    }
    var q = vector(4);
    vectorNear(act(d.l, d.r, q), M4.mulVec(R, q), 4e-15, 'point action');
    var R2 = randomSO4(), d2 = recover(R2);
    vectorNear(spin(qmul(d.l, d2.l), qmul(d.r, d2.r)), M4.mul(R, R2), 4e-15, 'group composition');
  }
  [M4.ident(), scale(M4.ident(), -1), M4.rotation('xy', Math.PI),
    spin(I, J), spin(K, ONE)].forEach(function (R) {
    var d = recover(R);
    vectorNear(spin(d.l, d.r), R, 6e-16, 'zero scalar / exact pi / tie cases');
  });
  var commutationRows = [];
  [I, J, K].forEach(function (e) {
    var C = matrixOf(function (q) { return sub(qmul(q, e), qmul(e, q)); });
    for (var i = 0; i < 4; i++) commutationRows.push(C.slice(4 * i, 4 * i + 4));
  });
  assert(rank(commutationRows, 1e-14) === 3, 'only real quaternions commute with i,j,k');
});

test('03 double angles, characteristic polynomial, isoclinic degeneracy and SO(3) contrast', function () {
  for (var k = 0; k < 2048; k++) {
    var R = rotations[k], d = recover(R), t = trace(R), c2 = 4 * (d.l[0] * d.l[0] + d.r[0] * d.r[0]) - 2;
    near(t, 4 * d.l[0] * d.r[0], 3e-15, 'trace invariant');
    near((t * t - trace(M4.mul(R, R))) / 2, c2, 6e-15, 'second characteristic coefficient');
    var lambda = 2 * random() - 1;
    var shifted = R.map(function (x, i) { return x - (i % 5 === 0 ? lambda : 0); });
    near(determinant(shifted, 4), Math.pow(lambda, 4) - t * Math.pow(lambda, 3) +
      c2 * lambda * lambda - t * lambda + 1, 1.2e-14, 'characteristic polynomial via determinant');
    var leftAxis = unit(d.l.slice(1)), rightAxis = unit(d.r.slice(1));
    var U = spin(section(leftAxis, leftAxis[0] >= 0), section(rightAxis, rightAxis[0] >= 0));
    var angleL = Math.atan2(norm(d.l.slice(1)), d.l[0]), angleR = Math.atan2(norm(d.r.slice(1)), d.r[0]);
    var normal = M4.mul(M4.rotation('xy', angleL - angleR), M4.rotation('zw', angleL + angleR));
    var rebuilt = M4.mul(M4.mul(U, normal), M4.transpose(U));
    normalFormError = Math.max(normalFormError, Math.max.apply(null, sub(rebuilt, R).map(Math.abs)));
    vectorNear(rebuilt, R, 4e-15, 'normal form reconstructs arbitrary QR rotation');
    var conjugating = rotations[(k + 1) % rotations.length];
    var conjugated = recover(M4.mul(M4.mul(conjugating, R), M4.transpose(conjugating)));
    near(Math.min(norm(sub([d.l[0], d.r[0]], [conjugated.l[0], conjugated.r[0]])),
      norm(add([d.l[0], d.r[0]], [conjugated.l[0], conjugated.r[0]]))), 0, 3e-15, 'ordered scalar pair modulo common sign is a conjugacy invariant');
    var alpha = 0.2 + random(), beta = 1.6 + random();
    var l = expPure([alpha, 0, 0]), r = expPure([beta, 0, 0]);
    vectorNear(spin(l, r), M4.mul(M4.rotation('xy', alpha - beta), M4.rotation('zw', alpha + beta)),
      5e-16, 'two plane angles');
    assert(Math.abs(determinant(sub(spin(l, r), M4.ident()), 4)) > 0.01, '4D need not have any fixed vector');
    var q = sphere(4), p = sphere(4);
    near(dot(q, act(l, ONE, q)), Math.cos(alpha), 7e-16, 'isoclinic displacement');
    vectorNear(spin(l, p), M4.mul(spin(ONE, p), spin(l, ONE)), 4e-16, 'left/right commute');
    var axis = sphere(3), s = expPure(scale(axis, random() * Math.PI));
    vectorNear(adj(s, axis), axis, 1e-15, '3D rotation has fixed axis');
    vectorNear(act(s, s, ONE), ONE, 7e-16, '3D stabilizer fixes scalar direction');
    var E = qmul(I, q);
    near(dot(qmul(l, q), E), Math.sin(alpha), 8e-16, 'isoclinic plane through q when axis is i');
    // Arbitrary commuting right rotations give different invariant-plane choices.
    var plane = P.wedge(q, qmul(I, q)), moved = P.transform(plane, spin(l, ONE));
    vectorNear(moved, plane, 1.5e-15, 'nonunique isoclinic invariant plane');
  }
  vectorNear(spin(scale(ONE, -1), ONE), scale(M4.ident(), -1), 0, 'one 2pi trackball loop is -I in 4D');
  vectorNear(adj(scale(ONE, -1), [0.2, -0.7, 0.3]), [0.2, -0.7, 0.3], 0, 'SO(3) trackball forgets lift sign');
});

test('04 Hodge involution, exterior definition, Lie ideals and Pfaffian', function () {
  for (var k = 0; k < 2048; k++) {
    var w = vector(6), z = vector(6), s = split(w), t = split(z);
    vectorNear(star(star(w)), w, 0, 'star squared');
    near(exterior4(w, star(z)), dot(w, z), 2e-15, 'star from oriented wedge definition');
    var wp = scale(add(w, star(w)), 0.5), wm = scale(sub(w, star(w)), 0.5);
    vectorNear(star(wp), wp, 0, '+ eigenspace');
    vectorNear(star(wm), scale(wm, -1), 0, '- eigenspace');
    near(dot(wp, wm), 0, 5e-16, 'orthogonal split');
    vectorNear(join(s.a, s.b), w, 2e-16, 'split reconstruction');
    var A = matrixOf(function (q) { return sub(qmul(pure(s.a), q), qmul(q, pure(s.b))); });
    vectorNear(A, P.toMatrix(w), 2e-16, 'generator matches existing plane signs');
    var bracket = split(P.commutator(w, z));
    vectorNear(bracket.a, scale(cross(s.a, t.a), 2), 8e-16, 'left Lie bracket');
    vectorNear(bracket.b, scale(cross(s.b, t.b), 2), 8e-16, 'right Lie bracket');
    vectorNear(P.commutator(wp, wm), [0, 0, 0, 0, 0, 0], 3e-16, 'commuting ideals');
    near(dot(w, w), 2 * (dot(s.a, s.a) + dot(s.b, s.b)), 2e-15, 'norm decomposition');
    near(pfaffian(w), dot(s.a, s.a) - dot(s.b, s.b), 7e-16, 'Pfaffian difference');
    near(exterior4(w, w), 2 * pfaffian(w), 1e-15, 'wedge square');
    var pfSquared = Math.pow(pfaffian(w), 2);
    near(determinant(P.toMatrix(w), 4), pfSquared, 1.5e-15 * Math.max(1, pfSquared), 'determinant (scaled forward error)');
  }
});

test('05 SO(4) equivariance, orientation reversal, plane spheres and lost central sign', function () {
  var reflection = M4.ident(); reflection[0] = -1;
  for (var k = 0; k < 2048; k++) {
    var R = rotations[k], d = recover(R), w = vector(6), s = split(w);
    var transformed = exteriorTransform(w, R), t = split(transformed);
    vectorNear(transformed, P.transform(w, R), 9e-16, 'independent exterior minors vs matrix conjugation');
    vectorNear(exteriorTransform(star(w), R), star(transformed), 3e-15, 'orientation-preserving Hodge equivariance');
    vectorNear(exteriorTransform(star(w), reflection), scale(star(exteriorTransform(w, reflection)), -1),
      0, 'reflection exchanges Hodge eigenspaces');
    vectorNear(t.a, adj(d.l, s.a), 3e-15, 'left 3D action');
    vectorNear(t.b, adj(d.r, s.b), 3e-15, 'right 3D action');
    near(dot(t.a, t.a), dot(s.a, s.a), 5e-15, 'left orbit invariant');
    near(dot(t.b, t.b), dot(s.b, s.b), 5e-15, 'right orbit invariant');
    near(pfaffian(transformed), pfaffian(w), 5e-15, 'oriented Pfaffian invariant');
    vectorNear(exteriorTransform(w, scale(R, -1)), transformed, 0, 'bivectors cannot distinguish R and -R');
    var u = M4.col(R, 0), v = M4.col(R, 1), B = P.wedge(u, v), plane = split(B);
    near(dot(B, B), 1, 4e-15, 'unit simple bivector');
    near(pfaffian(B), 0, 2e-16, 'Pluecker relation from independent vectors');
    near(norm(scale(plane.a, 2)), 1, 3e-15, 'first plane sphere');
    near(norm(scale(plane.b, 2)), 1, 3e-15, 'second plane sphere');
    var a = scale(sphere(3), 0.5), b = scale(sphere(3), 0.5), arbitraryPlane = join(a, b);
    var generator = P.toMatrix(arbitraryPlane), projector = scale(M4.mul(generator, generator), -1);
    vectorNear(M4.mul(projector, projector), projector, 8e-16, 'any sphere pair yields plane projector');
    near(trace(projector), 2, 1.5e-15, 'plane projector rank two');
    near(pfaffian(arbitraryPlane), 0, 4e-16, 'sphere pair is decomposable');
    // Reconstruct actual spanning vectors, independently of join/split inversion.
    var columnNorms = basis.map(function (_, i) { return norm(M4.col(projector, i)); });
    var index = columnNorms.indexOf(Math.max.apply(null, columnNorms));
    var e = unit(M4.col(projector, index)), f = M4.mulVec(generator, e);
    vectorNear(P.wedge(e, f), arbitraryPlane, 7e-16, 'sphere pair -> actual oriented two-plane');
  }
});

test('06 all orthogonal complex structures: two sphere families, not a preferred axis', function () {
  for (var k = 0; k < 2048; k++) {
    var a = sphere(3), b = sphere(3), A = spin(pure(a), ONE), B = spin(ONE, pure(b));
    [A, B].forEach(function (Q) {
      vectorNear(M4.mul(Q, Q), scale(M4.ident(), -1), 7e-16, 'J squared = -I');
      vectorNear(M4.mul(M4.transpose(Q), Q), M4.ident(), 7e-16, 'orthogonal J');
    });
    var alpha = random(), beta = random(), S = sub(scale(A, alpha), scale(B, beta));
    // B=-R_b; keep that sign when expanding (alpha A - beta B)^2.
    var expected = add(scale(M4.ident(), -(alpha * alpha + beta * beta)), scale(M4.mul(A, B), -2 * alpha * beta));
    vectorNear(M4.mul(S, S), expected, 2e-15, 'mixed square obstruction');
    near(trace(M4.mul(A, B)), 0, 3e-16, 'mixed operator is traceless');
    near(norm(M4.mul(A, B)), 2, 2e-15, 'mixed operator cannot vanish');
    var R = rotations[k], s = split(P.fromMatrix(M4.mul(M4.mul(R, A), M4.transpose(R))));
    near(norm(s.a), 1, 3e-15, 'SO(4) moves chosen complex axis within its sphere');
    near(norm(s.b), 0, 2e-15, 'orientation does not exchange families');
    [3, 5].forEach(function (n) {
      var D = Array.from({ length: n * n }, function (_, i) { return i % (n + 1) === 0 ? -1 : 0; });
      near(determinant(D, n), -1, 0, 'odd-dimensional determinant obstruction');
      var realDet = 2 * random() - 1;
      assert(realDet * realDet >= 0, 'a real determinant squared cannot be -1');
    });
  }
});

test('07 two bounded stereographic charts, inverse, chord metric and full group conformality', function () {
  for (var k = 0; k < 2048; k++) {
    var q = sphere(4), pole = q[3] <= 0 ? 1 : -1, u = stereo(q, pole);
    assert(norm(u) <= 1 + 5e-16, 'adaptive chart stays in unit ball');
    vectorNear(unstereo(u, pole), q, 5e-16, 'bounded inverse');
    var columns = inverseColumns(u, pole), metric = gram(columns), lambda = 2 / (1 + dot(u, u));
    vectorNear(metric, [lambda * lambda, 0, 0, 0, lambda * lambda, 0, 0, 0, lambda * lambda],
      3e-15, 'conformal metric');
    columns.forEach(function (v) { near(dot(q, v), 0, 6e-16, 'inverse derivative is tangent'); });
    var v = vector(3), p = unstereo(v, pole);
    near(dot(sub(q, p), sub(q, p)), 4 * dot(sub(u, v), sub(u, v)) /
      ((1 + dot(u, u)) * (1 + dot(v, v))), 3e-15, 'independent chord metric');
    if (norm(u) > 0.1) vectorNear(scale(stereo(q, -pole), dot(u, u)), u, 3e-15,
      'chart transition, denominator-scaled residual near excluded pole');
    if (1 - q[3] >= 0.1) vectorNear(M4.stereo4to3(q).slice(0, 3), stereo(q, 1), 1e-15, 'existing unclamped chart');
    var R = rotations[k], y = M4.mulVec(R, q), outPole = y[3] <= 0 ? 1 : -1;
    var f = stereo(y, outPole), lambdaOut = 2 / (1 + dot(f, f));
    var derivatives = columns.map(function (v0) { return dstereo(y, M4.mulVec(R, v0), outPole); });
    var factor = Math.pow(lambda / lambdaOut, 2);
    vectorNear(gram(derivatives), [factor, 0, 0, 0, factor, 0, 0, 0, factor], 9e-15, 'induced SO(4) action is conformal');
    vectorNear(unstereo(f, outPole), y, 2e-15, 'atlas action reconstructs rotation');
    var h = 0.00001, j = k % 3, du = [0, 0, 0]; du[j] = h;
    vectorNear(scale(sub(unstereo(add(u, du), pole), unstereo(sub(u, du), pole)), 1 / (2 * h)),
      columns[j], 5e-10, 'independent central-difference derivative (O(h^2))');
  }
  [-1, 1].forEach(function (w) {
    vectorNear(unstereo(stereo([0, 0, 0, w], -w), -w), [0, 0, 0, w], 0, 'both poles included by atlas');
  });
  var tiny = 1e-5, nearPole = [Math.sin(tiny), 0, 0, Math.cos(tiny)];
  assert(norm(sub(unstereo(M4.stereo4to3(nearPole).slice(0, 3), 1), nearPole)) > 1,
    'existing denominator clamp is not an exact mathematical chart near the pole');
});

test('08 global S3 frame, noncoordinate bracket, Hopf fibers and restricted equivariance', function () {
  for (var k = 0; k < 2048; k++) {
    var q = sphere(4), E = frame(q), h = hopf(q);
    // Sampling/normalization has its own forward-error budget. The algebraic
    // identity is Gram(q,qi,qj,qk)=|q|^2 I even for a nonunit q: its 7e-16
    // correctness tolerance is NOT relaxed to absorb the input's norm error.
    var normSquared = dot(q, q);
    near(normSquared, 1, 4 * Number.EPSILON, 'normalized input budget');
    vectorNear(gram([q].concat(E)), scale(M4.ident(), normSquared), 7e-16, 'global orthonormal tangent frame');
    vectorNear(sub(qmul(E[0], J), qmul(E[1], I)), scale(E[2], 2), 0, 'nonzero frame bracket');
    near(norm(h), 1, 9e-16, 'Hopf base lies on S2');
    var theta = 2 * Math.PI * random(), phase = expPure([theta, 0, 0]);
    vectorNear(hopf(qmul(q, phase)), h, 1e-15, 'whole circle fiber');
    var d = E.map(function (v) { return dhopf(q, v); });
    vectorNear(gram(d), [0, 0, 0, 0, 4, 0, 0, 0, 4], 7e-15, 'Hopf derivative kills one direction, stretches two by 2');
    var l = sphere(4), r = sphere(4), axis = qmul(qmul(conj(r), I), r);
    vectorNear(hopf(act(l, r, q)), adj(l, qmul(qmul(q, axis), conj(q)).slice(1)), 2e-15, 'full equivariance needs moving fiber axis');
    vectorNear(hopf(act(l, phase, q)), adj(l, h), 2e-15, 'fixed-axis subgroup equivariance');
    vectorNear(hopf(scale(q, -1)), h, 0, 'base loses phase, including antipode');
  }
  vectorNear(hopf(ONE), [1, 0, 0], 0, 'fiber-axis reference');
  vectorNear(hopf(act(ONE, J, ONE)), [-1, 0, 0], 0, 'fixed Hopf base is not equivariant under left action alone for arbitrary right rotations');
});

test('09 Hopf local phases, two-patch reconstruction and transition winding', function () {
  for (var k = 0; k < 2048; k++) {
    var q = sphere(4), n = hopf(q), north = n[0] >= 0, s = section(n, north);
    vectorNear(hopf(s), n, 1.5e-15, 'section from independent S3 point');
    var fiber = qmul(conj(s), q), theta = Math.atan2(fiber[1], fiber[0]);
    vectorNear(fiber.slice(2), [0, 0], 4e-16, 'fiber stabilizer has no j,k components');
    vectorNear(qmul(s, expPure([theta, 0, 0])), q, 9e-16, 'base + patch + phase reconstructs full point');
  }
  for (var trial = 0; trial < 32; trial++) {
    var count = 257 + trial, offset = random() * 2 * Math.PI, previous = undefined, winding = 0;
    for (var j = 0; j <= count; j++) {
      var phi = offset + j * 2 * Math.PI / count, n0 = [0, Math.cos(phi), Math.sin(phi)];
      var g = qmul(conj(section(n0, true)), section(n0, false));
      vectorNear(g, [-Math.sin(phi), Math.cos(phi), 0, 0], 4e-16, 'equatorial transition');
      var angle = Math.atan2(g[1], g[0]);
      if (previous !== undefined) winding += Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
      previous = angle;
    }
    near(winding / (2 * Math.PI), 1, 5e-15, 'degree-one transition, not a global product S2 x S1');
  }
});

test('10 Hopf torus coordinates and polar metric, with endpoint degeneracies', function () {
  for (var k = 0; k < 2048; k++) {
    var eta = random() * Math.PI / 2, u = random() * 2 * Math.PI, v = random() * 2 * Math.PI;
    var q = torus(eta, u, v), c = Math.cos(eta), s = Math.sin(eta);
    var de = [-s * Math.cos(u), -s * Math.sin(u), c * Math.cos(v), c * Math.sin(v)];
    var du = [-c * Math.sin(u), c * Math.cos(u), 0, 0];
    var dv = [0, 0, -s * Math.sin(v), s * Math.cos(v)];
    vectorNear(gram([de, du, dv]), [1, 0, 0, 0, c * c, 0, 0, 0, s * s], 7e-16, 'torus-coordinate metric');
    vectorNear(hopf(q), [Math.cos(2 * eta), Math.sin(2 * eta) * Math.sin(u + v),
      -Math.sin(2 * eta) * Math.cos(u + v)], 1.5e-15, 'base uses phase sum');
    var theta = random();
    vectorNear(qmul(q, expPure([theta, 0, 0])), torus(eta, u + theta, v - theta), 1e-15, 'fiber changes phase difference');
    var x = vector(4), rho = norm(x), direction = scale(x, 1 / rho), f = frame(direction);
    vectorNear(scale(direction, rho), x, 4e-16, 'polar reconstruction');
    var derivatives = [direction].concat(f.map(function (e) { return scale(e, rho); }));
    var metric = M4.ident().map(function (entry, i) { return entry * (i === 0 ? 1 : rho * rho); });
    vectorNear(gram(derivatives), metric, 1e-15 * Math.max(1, rho * rho), 'radial-angular metric (scaled forward error)');
    vectorNear(torus(0, u, v), torus(0, u, v + theta), 0, 'first endpoint collapses second phase');
    vectorNear(torus(Math.PI / 2, u, v), torus(Math.PI / 2, u + theta, v), 7e-17, 'second endpoint collapses first phase');
  }
});

test('11 record dimensions, exact colored coordinates, lost pairing and slice reconstruction', function () {
  for (var k = 0; k < 1024; k++) {
    var x = vector(4), y = vector(4), delta = 0.2 + random();
    vectorNear(M4.ortho4to3(x), [x[0], x[1], x[2], 1], 0, 'orthographic coordinates, not a constant map');
    vectorNear(M4.ortho4to3(x), M4.ortho4to3(add(x, [0, 0, 0, delta])), 0, 'orthographic fiber collision');
    var camera = [0, 0, 0, 4], farther = add(camera, scale(sub(x, camera), 1 + random()));
    vectorNear(M4.project4to3(x, 4).slice(0, 3), M4.project4to3(farther, 4).slice(0, 3),
      5e-16, 'perspective loses ray depth if scale is discarded');
    var projection = M4.project4to3(x, 4), multiplier = projection[3];
    vectorNear(scale(projection.slice(0, 3), 1 / multiplier).concat(4 - 4 / multiplier), x, 9e-16,
      'perspective + exact scale retains four coordinates');
    var record = [x[0], x[1], (x[2] + 1) / 2, (x[3] + 1) / 2];
    vectorNear([record[0], record[1], 2 * record[2] - 1, 2 * record[3] - 1], x, 0, 'ideal XY + two scalar colors');
    near(dot(sub(x, y), sub(x, y)), dot(sub(x.slice(0, 2), y.slice(0, 2)), sub(x.slice(0, 2), y.slice(0, 2))) +
      dot(sub(x.slice(2), y.slice(2)), sub(x.slice(2), y.slice(2))), 2e-15, 'paired complex planes preserve metric');
    var swapped = x.slice(0, 2).concat(y.slice(2));
    assert(norm(sub(swapped, x)) > 1e-8 && norm(sub(swapped, y)) > 1e-8, 'unlabelled two-view pairing ambiguity');
    vectorNear(swapped.slice(0, 2), x.slice(0, 2), 0, 'same first projection set');
    vectorNear(swapped.slice(2), y.slice(2), 0, 'same second projection set');
    var weight = [0.3 + random(), 0.3 + random(), 0.3 + random(), 0.3 + random()], threshold = random();
    var full = x.reduce(function (sum, value, i) { return sum + weight[i] * value * value; }, 0) <= threshold;
    var slice = weight[0] * x[0] * x[0] + weight[1] * x[1] * x[1] <=
      threshold - weight[2] * x[2] * x[2] - weight[3] * x[3] * x[3];
    assert(full === slice, 'two indexed 2D slice parameters recover arbitrary queried point of ellipsoid');
    var R = rotations[k];
    assert(rank([M4.col(R, 0), M4.col(R, 1)], 1e-12) === 2, '2D positional channel rank');
    assert(rank([M4.col(R, 0), M4.col(R, 1), M4.col(R, 2)], 1e-12) === 3, '3D positional channel rank');
    assert(rank(basis.map(function (_, i) { return M4.col(R, i); }), 1e-12) === 4, 'full point needs four local scalars');
    var l = sphere(4), r = sphere(4);
    var columns = [I, J, K].map(function (e) { return spin(qmul(e, l), r); }).concat(
      [I, J, K].map(function (e) { return spin(l, qmul(e, r)); }));
    assert(rank(columns, 1e-12) === 6, 'rotation control differential has six independent directions');
  }
});

test('12 finite display bit bound, visible boundary rank and invisible interiors', function () {
  for (var k = 0; k < 1024; k++) {
    var points = 1 + Math.floor(random() * 100), coordinateBits = 1 + Math.floor(random() * 16);
    var pixels = 1 + Math.floor(random() * 100), pixelBits = 1 + Math.floor(random() * 32);
    var sceneBits = 4 * points * coordinateBits, frameBits = pixels * pixelBits;
    var frames = Math.ceil(sceneBits / frameBits);
    assert((1n << BigInt(frames * frameBits)) >= (1n << BigInt(sceneBits)), 'enough codewords is necessary');
    assert((1n << BigInt((frames - 1) * frameBits)) < (1n << BigInt(sceneBits)), 'one fewer frame cannot encode all scenes');
    var direction = sphere(3), w = 0.5 + 0.49 * random();
    var q = scale(direction, Math.sqrt(1 - w * w)).concat(w), camera = [0, 0, 0, 3];
    var ray = sub(q, camera), distance = norm(ray), v = scale(ray, 1 / distance);
    function rayDerivative(e) { return scale(sub(e, scale(v, dot(v, e))), 1 / distance); }
    var D = frame(q).map(rayDerivative);
    assert(rank(D, 1e-12) === 3, 'visible regular boundary has three independent ray coordinates');
    var qw = scale(direction, Math.sqrt(8 / 9)).concat(1 / 3);
    ray = sub(qw, camera); distance = norm(ray); v = scale(ray, 1 / distance);
    D = frame(qw).map(rayDerivative);
    assert(rank(D, 1e-12) === 2, 'sphere silhouette loses one ray-coordinate rank');
    assert(rank([scale(qw, 2), camera], 1e-12) === 2, 'two independent constraints leave a 2D silhouette');
    // Same exact first hit for an opaque solid ball and an opaque shell.
    var origin = scale(sphere(4), 2 + random()), target = scale(sphere(4), 0.15);
    var rayUnit = unit(sub(target, origin)), b = dot(origin, rayUnit), c = dot(origin, origin) - 1;
    var discriminant = b * b - c;
    assert(discriminant > 0, 'ray crosses outer sphere');
    var hit = add(origin, scale(rayUnit, -b - Math.sqrt(discriminant)));
    near(dot(hit, hit), 1, 1.5e-14, 'common first-hit outer boundary');
    var interior = scale(sphere(4), random() * 0.4), length = norm(interior);
    assert(length < 1 && !(length >= 0.5 && length <= 1), 'solid and shell differ in unseen interior');
  }
});

test('13 constructive orbit completeness, missing slice features and actual standalone prototype', function () {
  function tangentPair(n) {
    var index = n.map(Math.abs).indexOf(Math.min.apply(null, n.map(Math.abs)));
    var e = [0, 0, 0]; e[index] = 1;
    var tangent = unit(cross(n, e));
    return [tangent, cross(n, tangent)];
  }
  for (var k = 0; k < 1024; k++) {
    var v = sphere(3), angle = 2 * Math.PI * random();
    var q = [Math.cos(angle / 2)].concat(scale(v, Math.sin(angle / 2))), x = vector(3);
    var rodrigues = add(add(scale(x, Math.cos(angle)), scale(cross(v, x), Math.sin(angle))),
      scale(v, dot(v, x) * (1 - Math.cos(angle))));
    vectorNear(adj(q, x), rodrigues, 2e-15, 'axis-angle formula from independent 3D dot/cross');
    assert(rank([v, cross([1, 0, 0], v), cross([0, 1, 0], v), cross([0, 0, 1], v)], 1e-12) === 3,
      'a nonzero so(3) ideal generates the full algebra');
    var alpha = 0.2 + 0.3 * random(), beta = 1.2 + 0.3 * random();
    var left = expPure([alpha, 0, 0]), right = expPure([beta, 0, 0]);
    near(trace(spin(left, right)), trace(spin(right, left)), 0, 'swapping lifts leaves trace unchanged');
    near(trace(M4.mul(spin(left, right), spin(left, right))),
      trace(M4.mul(spin(right, left), spin(right, left))), 0, 'swapping lifts leaves spectral coefficients unchanged');
    assert(Math.abs(left[0] - right[0]) > 0.4 && left[0] + right[0] > 0.8,
      'but ordered scalar pairs are not equal modulo common sign');
    var w = vector(6), s = split(w), a = sphere(3), b = sphere(3);
    var oldA = unit(s.a), oldB = unit(s.b);
    var l = qmul(section(a, a[0] >= 0), conj(section(oldA, oldA[0] >= 0)));
    var r = qmul(section(b, b[0] >= 0), conj(section(oldB, oldB[0] >= 0)));
    vectorNear(exteriorTransform(w, spin(l, r)), join(scale(a, norm(s.a)), scale(b, norm(s.b))), 4e-15,
      'same two lengths are sufficient: construct the group element');
    var zero = [0, 0, 0], planeColumns = tangentPair(a).map(function (t) { return join(scale(t, 0.5), zero); })
      .concat(tangentPair(b).map(function (t) { return join(zero, scale(t, 0.5)); }));
    assert(rank(planeColumns, 1e-12) === 4, 'oriented plane space has four independent local directions');
    var u4 = vector(4), v4 = vector(4), wedge = P.wedge(u4, v4);
    near(dot(wedge, wedge), dot(u4, u4) * dot(v4, v4) - Math.pow(dot(u4, v4), 2), 4e-15,
      'simple bivector squared area');
    var cuts = vector(9).sort(function (a0, b0) { return a0 - b0; });
    var gaps = cuts.slice(1).map(function (t, i) { return t - cuts[i]; });
    var gapIndex = gaps.indexOf(Math.max.apply(null, gaps));
    var center = (cuts[gapIndex] + cuts[gapIndex + 1]) / 2, width = gaps[gapIndex] / 3;
    function bump(t) {
      var z = (t - center) / width, value = Math.max(0, 1 - z * z);
      return value * value;
    }
    cuts.forEach(function (cut) { near(bump(cut), 0, 0, 'finite slices miss a supported C1 perturbation'); });
    near(bump(center), 1, 0, 'nonzero unsampled feature');
  }
  var sixBasis = Array.from({ length: 6 }, function (_, j) {
    return Array.from({ length: 6 }, function (_, i) { return i === j ? 1 : 0; });
  });
  assert(rank(sixBasis.map(function (b) { return scale(add(b, star(b)), 0.5); }), 1e-12) === 3, 'self-dual dimension');
  assert(rank(sixBasis.map(function (b) { return scale(sub(b, star(b)), 0.5); }), 1e-12) === 3, 'anti-self-dual dimension');

  var fs = require('fs'), path = require('path'), vm = require('vm');
  var html = fs.readFileSync(path.join(__dirname, '../proto/math/spin-atlas.html'), 'utf8');
  var scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g));
  assert(scripts.length === 1, 'one self-contained inline script');
  assert(!/[^\x00-\x7f]/.test(scripts[0][1]), 'prototype JavaScript is ASCII');
  assert(!/<script\b[^>]*\bsrc\s*=|https?:\/\//i.test(html), 'no external scripts or network URLs');
  var drawCalls = 0, elements = {}, downloaded, downloadName, revoked = false;
  function context2D() {
    var ctx = {};
    ['clearRect', 'beginPath', 'arc', 'stroke', 'fill', 'moveTo', 'lineTo', 'fillText'].forEach(function (method) {
      ctx[method] = function () {
        drawCalls++;
        Array.from(arguments).forEach(function (arg) {
          if (typeof arg === 'number') assert(Number.isFinite(arg), 'finite canvas argument');
        });
      };
    });
    return ctx;
  }
  ['leftBall', 'rightBall', 'atlas', 'leftReadout', 'rightReadout', 'diagnostics', 'notice',
    'leftLoop', 'bothLoops', 'reset', 'export'].forEach(function (id) {
    var ctx = context2D();
    elements[id] = {
      width: id === 'atlas' ? 960 : 280, height: id === 'atlas' ? 420 : 240, textContent: '', handlers: {},
      getContext: function (type) { assert(type === '2d', 'Canvas 2D only'); return ctx; },
      addEventListener: function (type, fn) { this.handlers[type] = fn; },
      getBoundingClientRect: function () { return { left: 0, top: 0, width: 280, height: 240 }; },
      setPointerCapture: function () {}, focus: function () {}
    };
  });
  var document = {
    getElementById: function (id) { assert(!!elements[id], 'existing DOM node: ' + id); return elements[id]; },
    createElement: function (tag) {
      assert(tag === 'a', 'download anchor');
      return { click: function () { downloadName = this.download; }, remove: function () {} };
    },
    body: { appendChild: function () {} }
  };
  var sandbox = {
    window: {}, document: document,
    Blob: function (parts, options) { this.parts = parts; this.type = options.type; },
    URL: {
      createObjectURL: function (blob) { downloaded = blob; return 'blob:math4-test'; },
      revokeObjectURL: function (url) { assert(url === 'blob:math4-test', 'revoke exact download'); revoked = true; }
    },
    setTimeout: function (fn) { fn(); }
  };
  vm.runInNewContext(scripts[0][1], sandbox, { filename: 'spin-atlas.inline.js', timeout: 3000 });
  var demo = sandbox.window.Math4Demo;
  assert(!!demo && drawCalls > 100, 'actual prototype initialized and rendered');
  var referenceSeeds = [ONE, [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    [Math.SQRT1_2, 0, -Math.SQRT1_2, 0], J];
  var referenceBases = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0]];
  demo.exportData().seedQuaternions.forEach(function (q, i) {
    vectorNear(hopf(q), referenceBases[i], 5e-16, 'F13 independent Hopf base');
    vectorNear(q, referenceSeeds[i], 2e-16, 'F13 independent phase-zero seed');
  });
  for (k = 0; k < 256; k++) {
    var R = rotations[k], decomposition = recover(R);
    demo.state.left = decomposition.l; demo.state.right = decomposition.r;
    var a4 = vector(4), b4 = vector(4);
    var leftMatrix = add(scale(M4.ident(), a4[0]), P.toMatrix(join(a4.slice(1), [0, 0, 0])));
    vectorNear(demo.mul(a4, b4), M4.mulVec(leftMatrix, b4), 9e-16, 'prototype product vs existing generator matrices');
    vectorNear(demo.rotate(a4), M4.mulVec(R, a4), 4e-15, 'prototype rotation vs unrelated QR matrix');
    var records = demo.samples(), data = demo.exportData();
    assert(records.length === 512 && data.sampleCountPerFiber === 128 && data.seedQuaternions.length === 4, 'export shape');
    for (var j = 0; j < records.length; j += 31) {
      var record = records[j], seedQuaternion = referenceSeeds[record.fiber];
      var expected = M4.mulVec(R, qmul(seedQuaternion, expPure([record.theta, 0, 0])));
      vectorNear(record.point, expected, 4e-15, 'actual sampled curve vs matrix action');
      near(norm(record.point), 1, 3e-15, 'prototype remains on S3');
      var pole = record.point[3] <= 0 ? 1 : -1, encoded = demo.chart(record.point, pole);
      assert(norm(encoded) <= 1 + 3e-15, 'prototype bounded atlas');
      vectorNear(demo.unchart(encoded, pole), record.point, 4e-15, 'prototype chart is invertible');
    }
    var from = sphere(3), to = sphere(3), delta = demo.deltaBetween(from, to);
    vectorNear(adj(delta, from), to, 3e-15, 'trackball delta maps independent source to destination');
    vectorNear(adj(demo.deltaBetween(from, scale(from, -1)), from), scale(from, -1), 1.5e-15, 'antipodal trackball case');
    var tangent = tangentPair(from)[0];
    [1e-4, 1e-8, 1e-12].forEach(function (offset) {
      var nearAntipode = unit(add(scale(from, -1), scale(tangent, offset)));
      vectorNear(adj(demo.deltaBetween(from, nearAntipode), from), nearAntipode, 3e-15,
        'near-antipodal control is accurate, not snapped to pi');
    });
  }
  var before = demo.samples()[0].point.slice();
  elements.leftLoop.handlers.click();
  vectorNear(demo.samples()[0].point, scale(before, -1), 0, 'single-lift button changes every point sign');
  before = demo.samples()[0].point.slice();
  elements.bothLoops.handlers.click();
  vectorNear(demo.samples()[0].point, before, 0, 'double-lift button is the same rotation');
  elements.reset.handlers.click();
  vectorNear(demo.state.left, ONE, 0, 'reset left'); vectorNear(demo.state.right, ONE, 0, 'reset right');
  function pointerEvent(x, y) {
    return { pointerId: 1, clientX: x, clientY: y, preventDefault: function () {} };
  }
  ['leftBall', 'rightBall'].forEach(function (id) {
    var handlers = elements[id].handlers;
    var side = id === 'leftBall' ? 'left' : 'right', oldState = demo.state[side].slice();
    // Invert the documented display camera as a 3x3 matrix, independently
    // of demo.unspatial/deltaBetween; screen y points down.
    var cy = Math.cos(0.6), sy = Math.sin(0.6), cp = Math.cos(-0.3), sp = Math.sin(-0.3);
    var inverse = [[cy, sy * sp, -sy * cp], [0, cp, sp], [sy, -cy * sp, cy * cp]];
    function screenVector(x, y) {
      var u = (x - 140) / 90, v = (120 - y) / 90, screen = [u, v, Math.sqrt(1 - u * u - v * v)];
      return inverse.map(function (row) { return dot(row, screen); });
    }
    var fromScreen = screenVector(140, 120), toScreen = screenVector(177, 82);
    var expectedDelta = unit([1 + dot(fromScreen, toScreen)].concat(cross(fromScreen, toScreen)));
    handlers.pointerdown(pointerEvent(140, 120));
    handlers.pointermove(pointerEvent(177, 82));
    handlers.pointerup(pointerEvent(177, 82));
    vectorNear(demo.state[side], unit(qmul(expectedDelta, oldState)), 5e-16, 'F13 actual drag direction and display inverse');
    var snapshot = demo.state.left.concat(demo.state.right);
    handlers.pointermove(pointerEvent(110, 90));
    vectorNear(demo.state.left.concat(demo.state.right), snapshot, 0, 'released pointer does not keep rotating');
    handlers.keydown({ key: 'Q', preventDefault: function () {} });
    handlers.keydown({ key: 'ArrowUp', preventDefault: function () {} });
  });
  assert(norm(sub(demo.state.left, ONE)) > 0.01 && norm(sub(demo.state.right, ONE)) > 0.01, 'both controls update real state');
  near(norm(demo.state.left), 1, 4e-16, 'left control normalized');
  near(norm(demo.state.right), 1, 4e-16, 'right control normalized');
  elements.export.handlers.click();
  var exported = JSON.parse(downloaded.parts.join(''));
  assert(downloaded.type === 'application/json' && revoked && downloadName === 'math4-spin-atlas.json', 'file export lifecycle');
  assert(exported.samples.length === 512 && exported.curveRule.indexOf('conjugate(right)') >= 0, 'complete data, not screenshot');
  vectorNear(exported.samples[0].point, demo.samples()[0].point, 0, 'JSON retains point coordinates');
});

test('F12 direct M4 contracts: every basic API and all six oriented planes', function () {
  var a = [1, -2, 3, -4], b = [-5, 6, 7, 8];
  near(M4.dot(a, b), -28, 0, 'dot');
  near(M4.len([1, 2, 2, 4]), 5, 0, 'length');
  vectorNear(M4.scale(a, -2), [-2, 4, -6, 8], 0, 'scale');
  vectorNear(M4.add(a, b), [-4, 4, 10, 4], 0, 'add');
  vectorNear(M4.sub(a, b), [6, -8, -4, -12], 0, 'subtract');
  vectorNear(M4.normalize([1, 2, 2, 4]), [0.2, 0.4, 0.4, 0.8], 0, 'normalize');
  vectorNear(M4.normalize([0, 0, 0, 0]), [0, 0, 0, 0], 0, 'zero normalization contract');
  var A = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  var B = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5];
  vectorNear(M4.ident(), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0, 'identity');
  var product = A.map(function (x, i) { return x * [2, 3, 4, 5][i % 4]; });
  vectorNear(M4.mul(A, B), product, 0, 'row-major product');
  vectorNear(M4.compose([A, B]), product, 0, 'ordered composition');
  vectorNear(M4.compose([]), M4.ident(), 0, 'empty composition');
  vectorNear(M4.mulVec(A, [1, 2, 3, 4]), [30, 70, 110, 150], 0, 'matrix vector');
  vectorNear(M4.transpose(A), [1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16], 0, 'transpose');
  for (var c = 0; c < 4; c++) vectorNear(M4.col(A, c), [1 + c, 5 + c, 9 + c, 13 + c], 0, 'column');
  [['xy', 0, 1], ['xz', 0, 2], ['xw', 0, 3], ['yz', 1, 2], ['yw', 1, 3], ['zw', 2, 3]].forEach(function (p) {
    [-1.3, 0, Math.PI / 2].forEach(function (angle) {
      var R = M4.rotation(p[0], angle);
      basis.forEach(function (e, j) {
        var expected = e.slice();
        if (j === p[1] || j === p[2]) {
          expected[j] = Math.cos(angle);
          expected[j === p[1] ? p[2] : p[1]] = (j === p[1] ? 1 : -1) * Math.sin(angle);
        }
        vectorNear(M4.mulVec(R, e), expected, 0, 'all plane basis actions ' + p[0]);
      });
    });
  });
  var s = Math.SQRT1_2, Q = [s, -s, 0, 0, s, s, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  var perturbed = M4.mul(Q, [2, 0.2, -0.1, 0.3, 0, 3, 0.4, -0.2, 0, 0, 4, 0.5, 0, 0, 0, 5]);
  vectorNear(M4.orthonormalize(perturbed), Q, 4e-16, 'Gram-Schmidt removes scale and shear, preserving column order');
  vectorNear(M4.project4to3([1, -2, 3, 2], 4), [2, -4, 6, 2], 0, 'perspective coordinates');
  vectorNear(M4.ortho4to3([1, -2, 3, 9]), [1, -2, 3, 1], 0, 'orthographic coordinates');
  vectorNear(M4.stereo4to3([1, 0, 0, 0]), [1, 0, 0, 1], 0, 'stereographic equator');
});

console.log('SO(4) matrix reconstruction max=' + reconstructionError.toExponential(6) +
  '; generic double-plane reconstruction max=' + normalFormError.toExponential(6));
console.log('\n' + passed + ' passed, ' + failed + ' failed; ' + totalAssertions + ' assertions; seed=' + initialSeed);
if (failed) process.exitCode = 1;

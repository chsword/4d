/* collide4.js: support-mapped 4D GJK and exact box/glome narrow phase.
 * normal points from A towards B; the separating displacement of B is normal*depth.
 * points are shared WORLD positions, not separate application points on A and B.
 */
(function (global) {
  'use strict';

  var EPS = 1e-10, ids = new WeakMap(), nextId = 1;
  function id(body) {
    if (!ids.has(body)) ids.set(body, nextId++);
    return ids.get(body);
  }
  function radius(body) {
    return body.shape === 'glome' ? body.radius : M4.len(body.halfSize);
  }
  function support(body, direction) {
    if (typeof body.support === 'function') return body.support(direction);
    if (body.shape === 'glome') {
      var length = M4.len(direction);
      return M4.add(body.position, M4.scale(length ? direction : [1, 0, 0, 0],
        body.radius / (length || 1)));
    }
    if (body.shape !== 'box4') throw new Error('Unsupported collision shape: ' + body.shape);
    var local = M4.mulVec(M4.transpose(body.orientation), direction);
    return M4.add(body.position, M4.mulVec(body.orientation, local.map(function (x, i) {
      return Math.sign(x) * body.halfSize[i];
    })));
  }
  function minkowski(a, b, d) {
    var pa = support(a, d), pb = support(b, M4.scale(d, -1));
    if (pa.length !== 4 || pb.length !== 4 || !pa.concat(pb).every(Number.isFinite)) {
      throw new Error('Support maps must return finite world-space 4-vectors');
    }
    return { p: M4.sub(pa, pb), a: pa, b: pb };
  }

  // Enumerate the <=31 faces. QR avoids squaring the condition number in a Gram
  // determinant; reorthogonalization also handles almost affinely dependent faces.
  function closest(simplex) {
    var best = null;
    for (var mask = 1; mask < (1 << simplex.length); mask++) {
      var face = simplex.filter(function (_, i) { return mask & (1 << i); });
      var origin = face[0].p, Q = [], R = [], rhs = [], valid = true;
      for (var j = 1; j < face.length; j++) {
        var edge = M4.sub(face[j].p, origin), v = edge.slice(), column = [];
        for (var k = 0; k < Q.length; k++) {
          column[k] = M4.dot(Q[k], v);
          v = M4.sub(v, M4.scale(Q[k], column[k]));
        }
        for (k = 0; k < Q.length; k++) {
          var correction = M4.dot(Q[k], v);
          column[k] += correction;
          v = M4.sub(v, M4.scale(Q[k], correction));
        }
        var length = M4.len(v);
        if (length <= 1e-13 * M4.len(edge)) { valid = false; break; }
        column[j - 1] = length;
        Q.push(M4.scale(v, 1 / length));
        R.push(column);
        rhs.push(-M4.dot(Q[j - 1], origin));
      }
      if (!valid) continue;
      var weights = new Array(face.length).fill(0);
      weights[0] = 1;
      for (j = face.length - 2; j >= 0; j--) {
        var x = rhs[j];
        for (k = j + 1; k < rhs.length; k++) x -= R[k][j] * weights[k + 1];
        weights[j + 1] = x / R[j][j];
        weights[0] -= weights[j + 1];
      }
      if (weights.some(function (w) { return w < -1e-12; })) continue;
      weights = weights.map(function (w) { return Math.max(0, w); });
      var sum = weights.reduce(function (s, w) { return s + w; }, 0);
      weights = weights.map(function (w) { return w / sum; });
      var p = [0, 0, 0, 0];
      face.forEach(function (s, i) { p = M4.add(p, M4.scale(s.p, weights[i])); });
      // Near contact, barycentric cancellation can leave a tangential error much
      // larger than |p|^2. Restore orthogonality before using p as a support direction.
      for (var sweep = 0; sweep < 2; sweep++) {
        Q.forEach(function (q) { p = M4.sub(p, M4.scale(q, M4.dot(q, p))); });
      }
      var distance2 = M4.dot(p, p);
      if (!best || distance2 < best.distance2) {
        best = { p: p, distance2: distance2, face: face, weights: weights };
      }
    }
    if (!best) throw new Error('GJK simplex has no finite closest face');
    return best;
  }

  function gjk(a, b) {
    var direction = M4.sub(b.position || [0, 0, 0, 0], a.position || [0, 0, 0, 0]);
    if (M4.len(direction) === 0) direction = [1, 0, 0, 0];
    var simplex = [minkowski(a, b, direction)], scale = Math.max(1, M4.len(simplex[0].p));
    for (var iteration = 0; iteration < 256; iteration++) {
      var near = closest(simplex), distance = Math.sqrt(near.distance2), tolerance = EPS * scale;
      var intersects = distance <= tolerance;
      var vertex = null, done = intersects;
      if (!done) {
        vertex = minkowski(a, b, M4.scale(near.p, -1));
        scale = Math.max(scale, M4.len(vertex.p));
        // The support plane gives a lower bound; this is an absolute distance gap.
        done = near.distance2 - M4.dot(near.p, vertex.p) <= tolerance * distance;
      }
      if (done) {
        var pa = [0, 0, 0, 0], pb = [0, 0, 0, 0];
        near.face.forEach(function (s, i) {
          pa = M4.add(pa, M4.scale(s.a, near.weights[i]));
          pb = M4.add(pb, M4.scale(s.b, near.weights[i]));
        });
        return { intersects: intersects, distance: intersects ? 0 : distance,
          pointA: pa, pointB: pb, iterations: iteration + 1 };
      }
      simplex = near.face.filter(function (_, i) { return near.weights[i] > 1e-13; });
      if (simplex.length >= 5) throw new Error('GJK retained a non-containing 4-simplex');
      simplex.push(vertex);
    }
    throw new Error('GJK did not converge in 256 iterations');
  }

  function det3(m) {
    return m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  }
  function cross4(u, v, w) {
    return [0, 1, 2, 3].map(function (i) {
      var minor = [];
      [u, v, w].forEach(function (row) {
        for (var j = 0; j < 4; j++) if (i !== j) minor.push(row[j]);
      });
      return (i % 2 ? -1 : 1) * det3(minor);
    });
  }
  function boxAxes(body) {
    return [0, 1, 2, 3].map(function (i) { return M4.col(body.orientation, i); });
  }
  function satAxes(a, b) {
    var A = boxAxes(a), B = boxAxes(b), axes = A.concat(B);
    for (var i = 0; i < 4; i++) {
      for (var j = i + 1; j < 4; j++) {
        for (var k = 0; k < 4; k++) {
          axes.push(cross4(A[i], A[j], B[k]));
          axes.push(cross4(B[i], B[j], A[k]));
        }
      }
    }
    return axes;
  }
  function boxProjections(a, b) {
    var A = boxAxes(a), B = boxAxes(b), projections = [];
    satAxes(a, b).forEach(function (axis) {
      var length = M4.len(axis);
      if (length < 1e-12) return;
      var n = M4.scale(axis, 1 / length), extent = 0;
      for (var i = 0; i < 4; i++) {
        extent += a.halfSize[i] * Math.abs(M4.dot(A[i], n)) +
          b.halfSize[i] * Math.abs(M4.dot(B[i], n));
      }
      projections.push({ normal: n, extent: extent });
    });
    return projections;
  }
  function boxSAT(a, b, projections) {
    var delta = M4.sub(b.position, a.position), depth = Infinity, normal = null;
    var tolerance = EPS * Math.max(1, radius(a), radius(b));
    if (!projections) projections = boxProjections(a, b);
    for (var k = 0; k < projections.length; k++) {
      var n = projections[k].normal, offset = M4.dot(delta, n);
      var overlap = projections[k].extent - Math.abs(offset);
      if (overlap < -tolerance) return null;
      if (overlap < depth) {
        depth = overlap;
        normal = M4.scale(n, offset < 0 ? -1 : 1);
      }
    }
    return { normal: normal, depth: Math.max(0, depth) };
  }
  function flip(hit) {
    if (!hit) return null;
    return Object.assign({}, hit, { normal: M4.scale(hit.normal, -1) });
  }
  function sat(a, b) {
    if (a.shape !== 'box4' || b.shape !== 'box4') throw new Error('SAT requires two box4 shapes');
    return id(a) < id(b) ? boxSAT(a, b) : flip(boxSAT(b, a));
  }
  function vertices(body) {
    var points = [];
    for (var mask = 0; mask < 16; mask++) {
      points.push(M4.add(body.position, M4.mulVec(body.orientation,
        body.halfSize.map(function (h, i) { return mask & (1 << i) ? h : -h; }))));
    }
    return points;
  }
  function inside(body, p, tolerance) {
    var local = M4.mulVec(M4.transpose(body.orientation), M4.sub(p, body.position));
    return local.every(function (x, i) { return Math.abs(x) <= body.halfSize[i] + tolerance; });
  }
  function boxManifold(a, b, hit) {
    var tolerance = 1e-7 * Math.max(1, radius(a), radius(b)), n = hit.normal;
    var plane = (M4.dot(support(a, n), n) + M4.dot(support(b, M4.scale(n, -1)), n)) / 2;
    var candidates = vertices(a).filter(function (p) { return inside(b, p, tolerance); })
      .concat(vertices(b).filter(function (p) { return inside(a, p, tolerance); }));
    // At the MTV boundary GJK supplies a point on both deepest support features,
    // including edge/face intersections with no vertex inside the opposite box.
    var shift = M4.scale(n, hit.depth);
    var moved = Object.assign({}, b, { position: M4.add(b.position, shift) });
    var witness = gjk(a, moved);
    candidates.push(M4.scale(M4.add(witness.pointA, M4.sub(witness.pointB, shift)), 0.5));
    var points = [];
    candidates.forEach(function (p) {
      p = M4.add(p, M4.scale(n, plane - M4.dot(p, n)));
      if (!points.some(function (q) { return M4.len(M4.sub(p, q)) <= tolerance * 8; })) points.push(p);
    });
    return points;
  }
  function glomes(a, b) {
    var delta = M4.sub(b.position, a.position), distance = M4.len(delta);
    var depth = a.radius + b.radius - distance;
    if (depth < -EPS * Math.max(1, a.radius, b.radius)) return null;
    var n = distance ? M4.scale(delta, 1 / distance) : [1, 0, 0, 0];
    var pa = M4.add(a.position, M4.scale(n, a.radius));
    var pb = M4.sub(b.position, M4.scale(n, b.radius));
    return { normal: n, depth: Math.max(0, depth), points: [M4.scale(M4.add(pa, pb), 0.5)] };
  }
  function glomeBox(a, b) {
    var local = M4.mulVec(M4.transpose(b.orientation), M4.sub(a.position, b.position));
    var q = local.map(function (x, i) { return Math.max(-b.halfSize[i], Math.min(b.halfSize[i], x)); });
    var delta = M4.sub(q, local), distance = M4.len(delta), n, depth;
    if (distance > 0) {
      depth = a.radius - distance;
      if (depth < -EPS * Math.max(1, a.radius, radius(b))) return null;
      n = M4.mulVec(b.orientation, M4.scale(delta, 1 / distance));
    } else {
      var axis = 0;
      for (var i = 1; i < 4; i++) {
        if (b.halfSize[i] - Math.abs(local[i]) < b.halfSize[axis] - Math.abs(local[axis])) axis = i;
      }
      var sign = local[axis] < 0 ? -1 : 1;
      depth = a.radius + b.halfSize[axis] - Math.abs(local[axis]);
      q[axis] = sign * b.halfSize[axis];
      n = M4.scale(M4.col(b.orientation, axis), -sign);
    }
    var pa = M4.add(a.position, M4.scale(n, a.radius));
    var pb = M4.add(b.position, M4.mulVec(b.orientation, q));
    return { normal: n, depth: Math.max(0, depth), points: [M4.scale(M4.add(pa, pb), 0.5)] };
  }
  function orderedCollision(a, b, manifold) {
    if (a.shape === 'glome' && b.shape === 'glome') return glomes(a, b);
    if (a.shape === 'glome' && b.shape === 'box4') return glomeBox(a, b);
    if (a.shape === 'box4' && b.shape === 'glome') return flip(glomeBox(b, a));
    if (a.shape !== 'box4' || b.shape !== 'box4') throw new Error('No penetration algorithm for these shapes');
    var hit = boxSAT(a, b);
    if (hit && manifold) hit.points = boxManifold(a, b, hit);
    return hit;
  }
  function collide(a, b) {
    return id(a) < id(b) ? orderedCollision(a, b, true) : flip(orderedCollision(b, a, true));
  }
  function broadPhase(a, b) {
    return M4.len(M4.sub(a.position, b.position)) <= radius(a) + radius(b) + 1e-8;
  }

  function pairContacts(a, b, hit, restitution) {
    return hit.points.map(function (point) {
      // The solver's normal is the impulse direction on `body`, hence B is body.
      var c = {
        body: b, other: a, r: M4.sub(point, b.position), rOther: M4.sub(point, a.position),
        normal: hit.normal, normalImpulse: 0, tangentImpulse: [0, 0, 0, 0]
      };
      c.normalMass = Physics4.contactMass(c, c.normal);
      c.restitution = restitution;
      c.target = -restitution * M4.dot(Physics4.contactVelocity(c), c.normal);
      return c;
    });
  }

  function solveWorld(world) {
    if (!Number.isFinite(world.restitution) || world.restitution < 0 || world.restitution > 1 ||
        !Number.isFinite(world.friction) || world.friction < 0) throw new Error('Invalid collision parameters');
    var bodies = world.bodies, i, j, hit, maxDepth = 0, pairs = [];
    for (i = 0; i < bodies.length; i++) {
      for (j = i + 1; j < bodies.length; j++) {
        var first = bodies[i], second = bodies[j];
        if (id(first) > id(second)) { first = bodies[j]; second = bodies[i]; }
        pairs.push({ a: first, b: second, projections: null });
      }
    }
    var floorOffsets = world.floorEnabled ? bodies.map(function (body) {
      return Physics4.floorContacts(body, world.floorY).separation + world.floorY - body.position[1];
    }) : [];
    // Split position correction: mass-weighting preserves the COM and total
    // uniform-gravity potential for pair corrections, without a velocity bias.
    for (var pass = 0; pass < 256; pass++) {
      maxDepth = 0;
      for (i = 0; i < pairs.length; i++) {
        var pair = pairs[i], a = pair.a, b = pair.b;
        if (!broadPhase(a, b)) continue;
        if (a.shape === 'box4' && b.shape === 'box4') {
          if (!pair.projections) pair.projections = boxProjections(a, b);
          hit = boxSAT(a, b, pair.projections);
        } else {
          hit = orderedCollision(a, b, false);
        }
        if (!hit) continue;
        maxDepth = Math.max(maxDepth, hit.depth);
        if (hit.depth <= 1e-11) continue;
        var correction = M4.scale(hit.normal, hit.depth / (a.invMass + b.invMass));
        a.position = M4.sub(a.position, M4.scale(correction, a.invMass));
        b.position = M4.add(b.position, M4.scale(correction, b.invMass));
      }
      if (world.floorEnabled) {
        bodies.forEach(function (body, index) {
          var depth = Math.max(0, world.floorY - body.position[1] - floorOffsets[index]);
          maxDepth = Math.max(maxDepth, depth);
          body.position[1] += depth;
        });
      }
      if (maxDepth <= 1e-11) break;
    }
    if (maxDepth > 1e-8) throw new Error('Pair position correction did not converge: ' + maxDepth);
    var contacts = [];
    for (i = 0; i < bodies.length; i++) {
      for (j = i + 1; j < bodies.length; j++) {
        if (!broadPhase(bodies[i], bodies[j])) continue;
        hit = collide(bodies[i], bodies[j]);
        if (hit) contacts = contacts.concat(pairContacts(bodies[i], bodies[j], hit, world.restitution));
      }
    }
    if (world.floorEnabled) {
      bodies.forEach(function (body) {
        Physics4.floorContacts(body, world.floorY).contacts.forEach(function (floor) {
          var c = { body: body, r: floor.r, normalImpulse: 0, tangentImpulse: [0, 0, 0, 0] };
          c.normalMass = Physics4.effectiveMass(body, c.r, [0, 1, 0, 0]);
          contacts.push(c);
        });
      });
    }
    // Reuse support impulses only for inelastic resting contacts, never an old
    // restitution impulse. Match one-to-one and reproject friction onto the new plane.
    var previous = world._collisionContacts || [], used = new Set();
    if (world.restitution === 0) {
      contacts.forEach(function (c) {
        var n = c.normal || [0, 1, 0, 0], match = -1, distance = 0.02;
        previous.forEach(function (old, index) {
          if (used.has(index) || old.body !== c.body || old.other !== c.other ||
              M4.dot(n, old.normal || [0, 1, 0, 0]) < 0.99) return;
          var d = M4.len(M4.sub(old.r, c.r));
          if (d < distance) { distance = d; match = index; }
        });
        if (match < 0) return;
        used.add(match);
        var old = previous[match];
        c.normalImpulse = old.normalImpulse + (old.impactImpulse || 0);
        c.tangentImpulse = M4.sub(old.tangentImpulse, M4.scale(n, M4.dot(old.tangentImpulse, n)));
        c.impactSolved = true;
        var impulse = M4.add(M4.scale(n, c.normalImpulse), c.tangentImpulse);
        c.body.applyImpulse(impulse, c.r);
        if (c.other) c.other.applyImpulse(M4.scale(impulse, -1), c.rOther);
      });
    }
    var result = Physics4.solveContacts(contacts, world.friction, 2048);
    if (result.change > 1e-12) throw new Physics4.ContactConvergenceError(result.change);
    world._solverResult = result;
    world._collisionContacts = world.restitution === 0 ? contacts : [];
    return result;
  }

  global.Collide4 = {
    support: support, gjk: gjk, cross4: cross4, satAxes: satAxes, sat: sat,
    collide: collide, vertices: vertices, broadPhase: broadPhase,
    pairContacts: pairContacts, solveWorld: solveWorld
  };
})(window);

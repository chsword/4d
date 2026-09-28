/* Scene data and primitive expressions are shared by CPU and GLSL. */
(function (global) {
  'use strict';

  function expr(op) { return { op: op, args: Array.prototype.slice.call(arguments, 1) }; }
  function sub(a, b) { return expr('sub', a, b); }
  function norm() { return expr.apply(null, ['length'].concat(Array.prototype.slice.call(arguments))); }
  function productDistance(ds) {
    return expr('add', expr('min', ds.reduce(function (a, b) { return expr('max', a, b); }), 0),
      expr.apply(null, ['length'].concat(ds.map(function (d) { return expr('max', d, 0); }))));
  }
  var boxDistances = ['x', 'y', 'z', 'w'].map(function (axis) {
    return sub(expr('abs', 'p.' + axis), 'h' + axis);
  });
  var types = {
    floor: { name: 'sdFloor4', params: [], convex: true, expression: 'p.y' },
    sphere: { name: 'sdSphere4', params: ['r'], convex: true,
      expression: sub(norm('p.x', 'p.y', 'p.z', 'p.w'), 'r') },
    box: { name: 'sdBox4', params: ['hx', 'hy', 'hz', 'hw'], convex: true,
      expression: productDistance(boxDistances) },
    duocylinder: { name: 'sdDuocylinder', params: ['r1', 'r2'], convex: true,
      expression: productDistance([sub(norm('p.x', 'p.y'), 'r1'), sub(norm('p.z', 'p.w'), 'r2')]) },
    spheritorus: { name: 'sdSpheritorus', params: ['R', 'r'], convex: false,
      expression: sub(norm(sub(norm('p.x', 'p.y', 'p.z'), 'R'), 'p.w'), 'r') },
    tiger: { name: 'sdTiger', params: ['R1', 'R2', 'r'], convex: false,
      expression: sub(norm(sub(norm('p.x', 'p.y'), 'R1'), sub(norm('p.z', 'p.w'), 'R2')), 'r') },
    pillar: { name: 'sdPillar', params: ['r', 'h'], convex: true,
      expression: productDistance([sub(norm('p.x', 'p.z'), 'r'), sub(expr('abs', 'p.y'), 'h')]) }
  };

  function float(n) {
    var s = String(n);
    if (!/[.e]/i.test(s)) s += '.0';
    return s;
  }
  // Share the predicates and advance expression, not just their constants.
  // CPU interprets this protocol; GLSL is emitted from the same expression AST.
  var ray = freeze({
    steps: 128,
    hit: expr('lt', 'distance', expr('mul', 0.0018, expr('max', 't', 1))),
    advance: expr('add', 't', expr('mul', 'distance', 0.92)),
    stop: expr('gt', 't', 70)
  });
  var rayGLSL = [
    'vec2 traceRay(vec3 rd, out float ghost){',
    '  float t = 0.0;',
    '  ghost = 0.0;',
    '  for (int i = 0; i < ' + ray.steps + '; i++) {',
    '    vec4 p = lift(rd * t);',
    '    vec2 h = map(p);',
    '    float distance = h.x;',
    '    if (uXRay > 0.5) {',
    '      float o = min(map(p + 1.1 * uAw).x, map(p - 1.1 * uAw).x);',
    '      ghost += (1.0 - smoothstep(0.0, 0.5, o)) * 0.014;',
    '    }',
    '    if (' + emit(ray.hit) + ') return vec2(t, h.y);',
    '    t = ' + emit(ray.advance) + ';',
    '    if (' + emit(ray.stop) + ') break;',
    '  }',
    '  return vec2(t, 0.0);',
    '}'
  ].join('\n');
  function emit(e) {
    if (typeof e === 'number') return float(e);
    if (typeof e === 'string') return e;
    var a = e.args.map(emit);
    var operators = { add: '+', sub: '-', mul: '*', lt: '<', gt: '>' };
    if (operators[e.op]) return '(' + a[0] + ' ' + operators[e.op] + ' ' + a[1] + ')';
    if (e.op === 'length') return 'length(vec' + a.length + '(' + a.join(', ') + '))';
    return e.op + '(' + a.join(', ') + ')';
  }
  function evaluate(e, p, params) {
    if (typeof e === 'number') return e;
    if (typeof e === 'string') return e.indexOf('p.') === 0 ? p['xyzw'.indexOf(e[2])] : params[e];
    var a = e.args.map(function (child) { return evaluate(child, p, params); });
    switch (e.op) {
      case 'add': return a[0] + a[1];
      case 'sub': return a[0] - a[1];
      case 'mul': return a[0] * a[1];
      case 'lt': return a[0] < a[1];
      case 'gt': return a[0] > a[1];
      case 'abs': return Math.abs(a[0]);
      case 'min': return Math.min(a[0], a[1]);
      case 'max': return Math.max(a[0], a[1]);
      case 'length': return Math.hypot.apply(Math, a);
      default: throw new Error('Unknown SDF operation: ' + e.op);
    }
  }
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { freeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }
  freeze(types);
  var library = Object.keys(types).map(function (key) {
    var t = types[key];
    return 'float ' + t.name + '(vec4 p' + t.params.map(function (name) { return ', float ' + name; }).join('') +
      '){ return ' + emit(t.expression) + '; }';
  }).join('\n') +
    '\nfloat sdBox4(vec4 p, vec4 b){ return sdBox4(p, b.x, b.y, b.z, b.w); }';

  function vector(v, name) {
    if (!Array.isArray(v) || v.length !== 4 || !v.every(Number.isFinite)) {
      throw new TypeError(name + ' must be a finite four-vector');
    }
  }
  function create(objects, collision) {
    if (!Array.isArray(objects) || !objects.length) throw new TypeError('Scene must contain primitives');
    var ids = Object.create(null);
    var entries = objects.map(function (o) {
      if (!Object.prototype.hasOwnProperty.call(types, o.type)) throw new TypeError('Unknown primitive: ' + o.type);
      if (typeof o.id !== 'string' || !o.id || ids[o.id]) throw new TypeError('Object IDs must be unique');
      ids[o.id] = true;
      vector(o.center, 'center');
      var t = types[o.type], params = {};
      if (!o.params || Object.keys(o.params).length !== t.params.length) throw new TypeError('Invalid primitive parameters');
      t.params.forEach(function (name) {
        if (!Number.isFinite(o.params[name]) || o.params[name] <= 0) throw new TypeError('Invalid parameter: ' + name);
        params[name] = o.params[name];
      });
      if (!Number.isInteger(o.material) || o.material < 1) throw new TypeError('Invalid material');
      var data = freeze({ id: o.id, type: o.type, center: o.center.slice(), params: params, material: o.material });
      return {
        data: data, convex: t.convex,
        sdf: function (p) { return evaluate(t.expression, M4.sub(p, data.center), params); },
        call: t.name + '(p - vec4(' + data.center.map(float).join(', ') + ')' +
          t.params.map(function (name) { return ', ' + float(params[name]); }).join('') + ')'
      };
    });
    function sample(p) {
      var distance = Infinity, object;
      entries.forEach(function (entry) {
        var d = entry.sdf(p);
        // Matches opU's tie rule in the shader.
        if (d <= distance) { distance = d; object = entry.data; }
      });
      return { distance: distance, object: object };
    }
    var scene = {
      objects: Object.freeze(entries.map(function (e) { return e.data; })),
      collision: collision === true,
      map: ['vec2 map(vec4 p){', '  vec2 res;'].concat(entries.map(function (e, i) {
        var value = 'vec2(' + e.call + ', ' + float(e.data.material) + ')';
        return '  res = ' + (i ? 'opU(res, ' + value + ')' : value) + ';';
      }), ['  return res;', '}']).join('\n'),
      sample: sample,
      sdf: function (p) { return sample(p).distance; },
      move: function (p, delta, radius) { return move(entries, p, delta, radius); },
      raycast: function (p, direction) {
        var t = 0;
        for (var i = 0; i < ray.steps; i++) {
          var point = M4.add(p, M4.scale(direction, t)), hit = sample(point);
          var state = { distance: hit.distance, t: t };
          if (evaluate(ray.hit, null, state)) {
            return { point: point, local: M4.sub(point, hit.object.center), object: hit.object, distance: t };
          }
          t = evaluate(ray.advance, null, state);
          state.t = t;
          if (evaluate(ray.stop, null, state)) break;
        }
        return null;
      }
    };
    return Object.freeze(scene);
  }

  var SKIN = 1e-6, CONTACT = 1e-9;
  function normal(sdf, p) {
    var n = p.map(function (_, axis) {
      var a = p.slice(), b = p.slice();
      a[axis] += 1e-5; b[axis] -= 1e-5;
      return sdf(a) - sdf(b);
    });
    var length = M4.len(n);
    if (length < 1e-12) throw new Error('Undefined camera contact normal');
    return M4.scale(n, 1 / length);
  }
  function nonconvexAdvance(entry, p, direction, gap) {
    var q = M4.sub(p, entry.data.center), params = entry.data.params;
    var a, b, da, db, minRadius;
    if (entry.data.type === 'spheritorus') {
      var rho = Math.hypot(q[0], q[1], q[2]);
      if (rho < 1e-10) return gap;
      a = rho - params.R; b = q[3]; minRadius = rho;
      da = (q[0] * direction[0] + q[1] * direction[1] + q[2] * direction[2]) / rho;
      db = direction[3];
    } else {
      var r1 = Math.hypot(q[0], q[1]), r2 = Math.hypot(q[2], q[3]);
      minRadius = Math.min(r1, r2);
      if (minRadius < 1e-10) return gap;
      a = r1 - params.R1; b = r2 - params.R2;
      da = (q[0] * direction[0] + q[1] * direction[1]) / r1;
      db = (q[2] * direction[2] + q[3] * direction[3]) / r2;
    }
    // Tube-distance Hessians have negative eigenvalues no smaller than
    // -1/rho (the base radial directions). For s <= minRadius/2,
    // f(p+s*d) >= f(p) + slope*s - curvature*s*s/2 up to first contact.
    // This certified quadratic bound progresses even on a departing tangent;
    // the global 1-Lipschitz bound alone can require arbitrarily many steps.
    var slope = (a * da + b * db) / Math.hypot(a, b), curvature = 2 / minRadius;
    var root = Math.sqrt(slope * slope + 2 * curvature * gap);
    var step = slope < 0 ? 2 * gap / (root - slope) : (slope + root) / curvature;
    return Math.max(gap, Math.min(minRadius / 2, step));
  }
  function sweep(entry, p, delta, radius) {
    var length = M4.len(delta), t = 0;
    var direction = M4.scale(delta, 1 / length);
    var padding = SKIN;
    // Leave positive clearance for a tangent ray; tracing the same offset
    // surface from exact contact would make zero progress.
    if (!entry.convex) padding = Math.min(SKIN, Math.max(0, (entry.sdf(p) - radius) * 0.5));
    for (var i = 0; i < 32768; i++) {
      var point = M4.add(p, M4.scale(delta, t));
      var clearance = entry.sdf(point) - radius, gap = clearance - padding;
      var n, closing;
      if (entry.convex || gap <= SKIN) {
        n = normal(entry.sdf, point);
        closing = -M4.dot(n, delta);
      }
      // For convex solids the closest-point supporting plane bounds the whole solid.
      // Tangential/away motion cannot cross that plane. Nonconvex primitives use
      // only the 1-Lipschitz distance bound, never this convex shortcut.
      if (entry.convex && closing <= 1e-12) return null;
      // At a grazing incidence, distance converges arbitrarily slowly even
      // though the center is already within a micron of the contact shell.
      // Use a spatial (not time/iteration) contact band for nonconvex grazes.
      if (!entry.convex && gap <= SKIN && closing > 1e-12 && closing < length * 0.1) {
        return { t: t, normal: n };
      }
      if (gap <= CONTACT) {
        if (closing > 1e-12) return { t: t, normal: n };
        gap = clearance * 0.5;
      }
      if (!entry.convex && gap <= SKIN && closing <= 1e-12) gap = Math.max(gap, clearance * 0.5);
      var step = entry.convex ? gap / closing : nonconvexAdvance(entry, point, direction, gap) / length;
      if (t + step > 1) return null;
      t += step * 0.99;
    }
    throw new Error('Camera sweep did not converge for ' + entry.data.id +
      ' (t=' + t + ', gap=' + gap + ', padding=' + padding + ', length=' + length + ', closing=' + closing + ')');
  }
  function move(entries, p, delta, radius) {
    vector(p, 'camera'); vector(delta, 'displacement');
    if (!Number.isFinite(radius) || radius <= 0) throw new TypeError('Camera radius must be positive');
    entries.forEach(function (entry) {
      if (entry.sdf(p) < radius - 1e-9) throw new RangeError('Camera starts inside ' + entry.data.id);
    });
    var position = p.slice(), remaining = delta.slice(), normals = [];
    if (M4.len(remaining) < 1e-10) return position;
    // A caller may supply an exactly touching start. Nonconvex sphere tracing
    // needs positive clearance even when departing tangentially.
    entries.forEach(function (entry) {
      var gap = entry.sdf(position) - radius;
      if (entry.convex || gap > CONTACT) return;
      var separated = M4.add(position, M4.scale(normal(entry.sdf, position), SKIN - gap));
      if (!entries.every(function (other) { return other.sdf(separated) >= radius; })) {
        throw new RangeError('No clearance for an initially touching camera at ' + entry.data.id);
      }
      position = separated;
    });
    for (var iteration = 0; iteration < 64; iteration++) {
      if (M4.len(remaining) < 1e-10) return position;
      var first = null;
      entries.forEach(function (entry) {
        var hit = sweep(entry, position, remaining, radius);
        if (hit && (!first || hit.t < first.t)) first = hit;
      });
      if (!first) return M4.add(position, remaining);
      position = M4.add(position, M4.scale(remaining, first.t));
      remaining = M4.scale(remaining, 1 - first.t);
      // Retain the contact planes for this move: one plane slides, two form
      // a crease. This also prevents endless recontacts in concave pockets.
      var independent = first.normal.slice();
      for (var orthogonalize = 0; orthogonalize < 2; orthogonalize++) {
        normals.forEach(function (n) { independent = M4.sub(independent, M4.scale(n, M4.dot(independent, n))); });
      }
      if (M4.len(independent) > 1e-12) normals.push(M4.normalize(independent));
      if (normals.length === 4) return position;
      for (var pass = 0; pass < 2; pass++) {
        normals.forEach(function (n) { remaining = M4.sub(remaining, M4.scale(n, M4.dot(remaining, n))); });
      }
    }
    throw new Error('Camera slide did not converge (planes=' + normals.length +
      ', remaining=' + M4.len(remaining) + ', t=' + first.t + ')');
  }

  var gallery = create([
    { id: 'floor', type: 'floor', center: [0, -1.5, 0, 0], params: {}, material: 1 },
    { id: 'glome', type: 'sphere', center: [-8, 0.3, -10, 0], params: { r: 1.45 }, material: 2 },
    { id: 'box', type: 'box', center: [-4, 0.3, -10, 0], params: { hx: 1.1, hy: 1.1, hz: 1.1, hw: 1.1 }, material: 3 },
    { id: 'duocylinder', type: 'duocylinder', center: [0, 0.3, -10, 0], params: { r1: 1.15, r2: 1.15 }, material: 4 },
    { id: 'spheritorus', type: 'spheritorus', center: [4, 0.3, -10, 0], params: { R: 1.15, r: 0.45 }, material: 5 },
    { id: 'tiger', type: 'tiger', center: [8, 0.3, -10, 0], params: { R1: 1, R2: 1, r: 0.34 }, material: 6 },
    { id: 'wall', type: 'box', center: [0, 0.5, -17, 0], params: { hx: 9, hy: 2, hz: 0.3, hw: 1.6 }, material: 7 },
    { id: 'treasure', type: 'box', center: [0, -0.7, -21, 3], params: { hx: 0.85, hy: 0.85, hz: 0.85, hw: 0.85 }, material: 8 },
    { id: 'pillar-left', type: 'pillar', center: [-12, 1, -6, 0], params: { r: 0.25, h: 2.5 }, material: 9 },
    { id: 'pillar-right', type: 'pillar', center: [12, 1, -6, 0], params: { r: 0.25, h: 2.5 }, material: 9 }
  ], true);
  global.Scene4 = Object.freeze({
    types: types, library: library, ray: ray, rayGLSL: rayGLSL, create: create, gallery: gallery,
    linked: create(gallery.objects.filter(function (o) {
      return ['floor', 'wall', 'treasure'].indexOf(o.id) >= 0;
    }), true)
  });
})(window);

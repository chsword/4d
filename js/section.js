/* Sections of convex planar faces, supplied as edge-index pairs. */
(function (global) {
  'use strict';
  function cut(points, faces, distances) {
    var eps = 1e-9, verts = [], edges = [], seen = Object.create(null);
    function distance(a, b) { return Math.hypot.apply(Math, a.map(function (x, i) { return x - b[i]; })); }
    function vertex(p) {
      for (var i = 0; i < verts.length; i++) if (distance(verts[i], p) <= eps) return i;
      verts.push(p.slice()); return verts.length - 1;
    }
    function edge(a, b) {
      if (a === b) return;
      var key = Math.min(a, b) + ':' + Math.max(a, b);
      if (!seen[key]) { seen[key] = true; edges.push([a, b]); }
    }
    faces.forEach(function (face) {
      var hits = [];
      var coplanar = face.every(function (e) {
        return Math.abs(distances[e[0]]) <= eps && Math.abs(distances[e[1]]) <= eps;
      });
      face.forEach(function (e) {
        var a = points[e[0]], b = points[e[1]], da = distances[e[0]], db = distances[e[1]];
        if (coplanar) { edge(vertex(a), vertex(b)); return; }
        if (Math.abs(da) <= eps) hits.push(vertex(a));
        if (Math.abs(db) <= eps) hits.push(vertex(b));
        if ((da < -eps && db > eps) || (db < -eps && da > eps)) {
          hits.push(vertex(a.map(function (x, i) { return x + (b[i] - x) * da / (da - db); })));
        }
      });
      hits = Array.from(new Set(hits));
      var best = eps, pair;
      hits.forEach(function (a, i) {
        hits.slice(i + 1).forEach(function (b) {
          var d = distance(verts[a], verts[b]);
          if (d > best) { best = d; pair = [a, b]; }
        });
      });
      if (pair) edge(pair[0], pair[1]);
    });
    var basis = [];
    verts.slice(1).forEach(function (p) {
      var v = p.map(function (x, i) { return x - verts[0][i]; });
      for (var pass = 0; pass < 2; pass++) basis.forEach(function (b) {
        var dot = v.reduce(function (s, x, i) { return s + x * b[i]; }, 0);
        v = v.map(function (x, i) { return x - dot * b[i]; });
      });
      var length = Math.hypot.apply(Math, v);
      if (length > eps) basis.push(v.map(function (x) { return x / length; }));
    });
    return { verts: verts, edges: edges, dimension: verts.length ? basis.length : -1 };
  }
  global.Section4 = { cut: cut };
})(window);

/* A03：材料坐标不变，运动只由二维铰链的 SO(4) 旋转产生。 */
(function (global) {
  'use strict';
  var tolerance = 16 * Number.EPSILON;
  var cells = [
    { id: 'A', axis: 3, sign: -1, center: [0, 0, 0, 0], parent: -1, fixed: 'w=0' },
    { id: 'B', axis: 0, sign: -1, center: [-2, 0, 0, 0], parent: 0, fixed: 'x=-1' },
    { id: 'C', axis: 0, sign: 1, center: [2, 0, 0, 0], parent: 0, fixed: 'x=+1' },
    { id: 'D', axis: 1, sign: -1, center: [0, -2, 0, 0], parent: 0, fixed: 'y=-1' },
    { id: 'E', axis: 1, sign: 1, center: [0, 2, 0, 0], parent: 0, fixed: 'y=+1' },
    { id: 'F', axis: 2, sign: -1, center: [0, 0, -2, 0], parent: 0, fixed: 'z=-1' },
    { id: 'G', axis: 2, sign: 1, center: [0, 0, 2, 0], parent: 0, fixed: 'z=+1' },
    { id: 'H', axis: 3, sign: 1, center: [0, 4, 0, 0], parent: 4, fixed: 'w=2' }
  ];
  var corners = [], edges = [];
  for (var i = 0; i < 8; i++) {
    corners.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, 0]);
    for (var a = 0; a < 3; a++) if (!(i & (1 << a))) edges.push([i, i | (1 << a)]);
  }
  var faces = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4],
    [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
  var faceNames = ['x−', 'x+', 'y−', 'y+', 'z−', 'z+'];
  var markers = [{ id: 'P', p: [0.15, -0.1, 0.2, 0] }, { id: 'Q', p: [-0.55, 0.4, -0.3, 0] }];
  function vector(p) {
    if (!Array.isArray(p) || p.length !== 4 || !p.every(Number.isFinite)) throw new Error('需要有限四维坐标');
  }
  function progress(t) {
    if (!Number.isFinite(t) || t < 0 || t > 1) throw new Error('折叠进度必须在 [0,1]');
    return { theta: Math.PI / 2 * Math.min(2 * t, 1), phi: Math.PI / 2 * Math.max(2 * t - 1, 0) };
  }
  function hinge(p, axis, pivot, angle) {
    vector(p);
    if (!Number.isInteger(axis) || axis < 0 || axis > 2 || !Number.isFinite(pivot) || !Number.isFinite(angle)) {
      throw new Error('无效的二维铰链');
    }
    var q = p.slice(), x = p[axis] - pivot, c = Math.cos(angle), s = Math.sin(angle);
    q[axis] = pivot + c * x - s * p[3];
    q[3] = s * x + c * p[3];
    return q;
  }
  function point(index, local, t) {
    if (!Number.isInteger(index) || index < 0 || index >= cells.length) throw new Error('未知胞编号');
    vector(local);
    if (local[3] !== 0) throw new Error('胞的本地材料坐标必须在 w=0');
    var cell = cells[index], angles = progress(t);
    var p = local.map(function (v, axis) { return v + cell.center[axis]; });
    if (index === 0) return p;
    if (index === 7) {
      // 子铰链先作用；否则 H 会绕世界里的错误位置转，脱离随 E 运动的接缝。
      return hinge(hinge(p, 1, 3, angles.phi), 1, 1, angles.theta);
    }
    return hinge(p, cell.axis, cell.sign, cell.sign * angles.theta);
  }
  function vertices(index, t) { return corners.map(function (p) { return point(index, p, t); }); }
  function geometry(t) { return cells.map(function (_, i) { return vertices(i, t); }); }
  function distance(a, b) { return M4.len(M4.sub(a, b)); }
  function incidence(ps) {
    if (!Array.isArray(ps) || ps.length !== 8) throw new Error('需要八胞几何');
    var verts = [], faceMap = new Map(), edgeMap = new Map();
    function record(map, ids, owner) {
      var key = ids.slice().sort(function (a, b) { return a - b; }).join(',');
      if (!map.has(key)) map.set(key, { ids: ids.slice(), owners: [] });
      map.get(key).owners.push(owner);
    }
    ps.forEach(function (vs, cell) {
      if (!Array.isArray(vs) || vs.length !== 8) throw new Error('每胞需要八个材料顶点');
      var ids = vs.map(function (p, vertex) {
        vector(p);
        var id = verts.findIndex(function (v) { return distance(v.p, p) <= tolerance; });
        if (id < 0) { id = verts.length; verts.push({ p: p.slice(), owners: [] }); }
        verts[id].owners.push({ cell: cell, vertex: vertex });
        return id;
      });
      faces.forEach(function (f, face) { record(faceMap, f.map(function (i) { return ids[i]; }), { cell: cell, face: face }); });
      edges.forEach(function (e, edge) { record(edgeMap, e.map(function (i) { return ids[i]; }), { cell: cell, edge: edge }); });
    });
    return { vertices: verts, edges: Array.from(edgeMap.values()), faces: Array.from(faceMap.values()) };
  }
  function seams() {
    var end = geometry(1), start = geometry(0), mesh = incidence(end);
    return mesh.faces.map(function (f) {
      if (f.ids.length !== 4 || new Set(f.ids).size !== 4 || f.owners.length !== 2 ||
          f.owners[0].cell === f.owners[1].cell) throw new Error('终态正方形未被两个不同胞逐面配对');
      var a = f.owners[0], b = f.owners[1];
      var pairs = faces[a.face].map(function (i) {
        var j = faces[b.face].find(function (j) { return distance(end[a.cell][i], end[b.cell][j]) <= tolerance; });
        if (j === undefined) throw new Error('接缝材料顶点无法对应');
        return [i, j];
      });
      if (new Set(pairs.map(function (p) { return p[1]; })).size !== 4) throw new Error('接缝材料点不是一一对应');
      return { a: a, b: b, pairs: pairs, retained: pairs.every(function (p) {
        return distance(start[a.cell][p[0]], start[b.cell][p[1]]) <= tolerance;
      }) };
    });
  }
  function seamGaps(seam, ps) {
    return seam.pairs.map(function (p) { return distance(ps[seam.a.cell][p[0]], ps[seam.b.cell][p[1]]); });
  }
  function measure(ps) {
    var maxDrift = 0;
    ps.forEach(function (vs) {
      for (var i = 0; i < 8; i++) for (var j = i + 1; j < 8; j++) {
        maxDrift = Math.max(maxDrift, Math.abs(distance(vs[i], vs[j]) - distance(corners[i], corners[j])));
      }
    });
    return maxDrift;
  }
  cells.forEach(function (c) { Object.freeze(c.center); Object.freeze(c); });
  [corners, edges, faces].forEach(function (list) { list.forEach(Object.freeze); Object.freeze(list); });
  markers.forEach(function (m) { Object.freeze(m.p); Object.freeze(m); });
  global.Net4 = Object.freeze({
    cells: Object.freeze(cells), corners: corners, edges: edges, faces: faces,
    faceNames: Object.freeze(faceNames), markers: Object.freeze(markers), tolerance: tolerance,
    progress: progress, hinge: hinge, point: point, vertices: vertices, geometry: geometry,
    incidence: incidence, seams: seams, seamGaps: seamGaps, measure: measure
  });
})(window);

/* 材料坐标是唯一事实来源；镜像只用于建立固定目标，不参与运动路径。 */
(function (global) {
  'use strict';

  var markers = [
    { id: 'P', name: '掌心', color: '#ff7777', p: [0, -0.2, -0.24, 0] },
    { id: 'D', name: '手背', color: '#80cfff', p: [0, -0.2, 0.24, 0] },
    { id: 'W', name: '腕', color: '#dbe4f2', p: [0, -1.2, 0, 0] },
    { id: 'T', name: '拇指尖', color: '#ffd24a', p: [1.18, 0.37, 0, 0] },
    { id: 'I', name: '食指尖', color: '#a8dfbd', p: [0.48, 1.42, 0, 0] },
    { id: 'M', name: '中指尖', color: '#ceb5ff', p: [0.16, 1.63, 0, 0] },
    { id: 'R', name: '无名指尖', color: '#ffbc91', p: [-0.16, 1.5, 0, 0] },
    { id: 'L', name: '小指尖', color: '#a6b9ff', p: [-0.48, 1.13, 0, 0] },
    { id: 'A', name: '掌左缘', color: '#80cfff', p: [-0.6, -0.2, 0, 0] },
    { id: 'B', name: '掌右缘', color: '#ffd24a', p: [0.6, -0.2, 0, 0] }
  ];
  var center = markers.reduce(function (sum, m) { return M4.add(sum, m.p); }, [0, 0, 0, 0]);
  center = M4.scale(center, 1 / markers.length);
  markers.forEach(function (m) { m.p = M4.sub(m.p, center); });
  var points = markers.map(function (m) { return m.p; });

  var vertices = [], faces = [], edges = [];
  function box(c, h, tilt, color) {
    var start = vertices.length, R = M4.rotation('xy', tilt);
    for (var i = 0; i < 8; i++) {
      var p = [(i & 1 ? 1 : -1) * h[0], (i & 2 ? 1 : -1) * h[1],
        (i & 4 ? 1 : -1) * h[2], 0];
      vertices.push(M4.sub(M4.add(M4.mulVec(R, p), c), center));
      for (var a = 0; a < 3; a++) if (!(i & (1 << a))) edges.push([start + i, start + (i | (1 << a))]);
    }
    var ids = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4],
      [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    var colors = ['#e8b285', '#557baf', '#a47e68', '#f2c9a8', '#ac8c78', '#c69b79'];
    ids.forEach(function (f, j) {
      faces.push({ ids: f.map(function (v) { return start + v; }), color: color || colors[j] });
    });
  }
  box([0, -0.15, 0, 0], [0.64, 0.65, 0.2], 0);
  box([0, -1.07, 0, 0], [0.36, 0.3, 0.17], 0);
  box([0.84, -0.06, 0, 0], [0.19, 0.58, 0.16], -0.7);
  box([0, -0.2, -0.235, 0], [0.12, 0.12, 0.035], 0, '#ef6464');
  box([0, -0.2, 0.235, 0], [0.08, 0.12, 0.035], 0, '#80cfff');
  box([0.25, -0.2, 0.235, 0], [0.08, 0.12, 0.035], 0, '#80cfff');
  [-0.48, -0.16, 0.16, 0.48].forEach(function (x, i) {
    var length = [0.73, 1.1, 1.23, 1.02][i];
    box([x, 0.4 + length / 2, 0, 0], [0.125, length / 2, 0.15], 0);
  });

  function mirror(p) { return [-p[0], p[1], p[2], p[3]]; }
  function transform(ps, R) { return ps.map(function (p) { return M4.mulVec(R, p); }); }
  function rotation3(xy, xz, yz) {
    return M4.compose([M4.rotation('xy', xy), M4.rotation('xz', xz), M4.rotation('yz', yz)]);
  }
  function rotation4(theta) { return M4.rotation('xw', theta); }
  function det3(m) {
    return m[0] * (m[4] * m[8] - m[5] * m[7])
      - m[1] * (m[3] * m[8] - m[5] * m[6])
      + m[2] * (m[3] * m[7] - m[4] * m[6]);
  }
  function det4(m) {
    var value = 0;
    for (var c = 0; c < 4; c++) {
      var minor = [];
      for (var r = 1; r < 4; r++) for (var k = 0; k < 4; k++) {
        if (k !== c) minor.push(m[r * 4 + k]);
      }
      value += (c % 2 ? -1 : 1) * m[c] * det3(minor);
    }
    return value;
  }
  function tangents(ps) { return ps.slice(1).map(function (p) { return M4.sub(p, ps[0]); }); }
  function signedVolume(ps) {
    var b = tangents(ps);
    return det3([b[0][0], b[1][0], b[2][0], b[0][1], b[1][1], b[2][1],
      b[0][2], b[1][2], b[2][2]]) / 6;
  }
  function materialVolume(ps) {
    var b = tangents(ps), gram = [];
    b.forEach(function (u) { b.forEach(function (v) { gram.push(M4.dot(u, v)); }); });
    // 本例四点始终线性独立；若出现负行列式，不能用钳零掩盖几何错误。
    var d = det3(gram);
    if (!(d > 0)) throw new Error('材料四面体退化，无法计算体积');
    return Math.sqrt(d) / 6;
  }
  var target = points.map(mirror), targetVertices = vertices.map(mirror);
  var witnessIds = [8, 9, 2, 0];
  function witness(ps) { return witnessIds.map(function (i) { return ps[i]; }); }
  var referenceLength = M4.len(M4.sub(points[9], points[8]));
  function errors(ps) {
    if (ps.length !== target.length) throw new Error('材料点数量不匹配，不能重新配点');
    return ps.map(function (p, i) { return M4.len(M4.sub(p, target[i])); });
  }
  function mismatch(ps) {
    var ds = errors(ps);
    return Math.sqrt(ds.reduce(function (sum, d) { return sum + d * d; }, 0) / ds.length) / referenceLength;
  }

  // 质心对齐已消去最优平移。C 的最小特征值下界给出所有 SO(3) 的误差下界，
  // 而不是把有限次搜索的最好成绩冒充“不可能”的证明。
  var covariance = [];
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
    covariance.push(points.reduce(function (sum, p) { return sum + p[r] * p[c]; }, 0) / points.length);
  }
  var lambdaLower = Math.min.apply(null, [0, 1, 2].map(function (i) {
    var v = covariance[i * 3 + i];
    for (var j = 0; j < 3; j++) if (j !== i) v -= Math.abs(covariance[i * 3 + j]);
    return v;
  }));
  if (!(lambdaLower > 0)) throw new Error('材料点未能给出正的 SO(3) 失配下界');
  var lowerBound = 2 * Math.sqrt(lambdaLower) / referenceLength;

  // 冻结模型可防止视图把原坐标改成目标，再把那个结果称作旋转。
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (key) { freeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }
  global.Chirality4 = freeze({
    markers: markers, points: points, vertices: vertices, faces: faces, edges: edges,
    target: target, targetVertices: targetVertices, witnessIds: witnessIds,
    referenceLength: referenceLength, covariance: covariance, lowerBound: lowerBound,
    transform: transform, rotation3: rotation3, rotation4: rotation4, det3: det3, det4: det4,
    witness: witness, signedVolume: signedVolume, materialVolume: materialVolume,
    errors: errors, mismatch: mismatch
  });
})(window);

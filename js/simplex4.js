/* 等距点的证据只来自材料坐标；相机不参与距离、下界或成功判定。 */
(function (global) {
  'use strict';
  var tetra = [[1, 1, 1, 0], [1, -1, -1, 0], [-1, 1, -1, 0], [-1, -1, 1, 0]];
  var triangle = [[1, 0, 0, 0], [-0.5, Math.sqrt(3) / 2, 0, 0], [-0.5, -Math.sqrt(3) / 2, 0, 0]];
  [tetra, triangle].forEach(function (ps) { ps.forEach(Object.freeze); Object.freeze(ps); });
  function point(p) {
    if (!Array.isArray(p) || p.length !== 4 || !p.every(Number.isFinite)) throw new Error('需要有限的四维坐标');
  }
  function create(dimension, scale, rotation) {
    if (dimension !== 2 && dimension !== 3) throw new Error('基底维数必须为 2 或 3');
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('尺寸必须为有限正数');
    rotation = rotation || M4.ident();
    if (!Array.isArray(rotation) || rotation.length !== 16 || !rotation.every(Number.isFinite)) throw new Error('无效基底旋转');
    var gram = M4.mul(M4.transpose(rotation), rotation), identity = M4.ident();
    var det = rotation[0] * (rotation[5] * rotation[10] - rotation[6] * rotation[9]) -
      rotation[1] * (rotation[4] * rotation[10] - rotation[6] * rotation[8]) +
      rotation[2] * (rotation[4] * rotation[9] - rotation[5] * rotation[8]);
    if (gram.some(function (v, i) { return Math.abs(v - identity[i]) > 1e-12; }) ||
        Math.abs(det - 1) > 1e-12 ||
        rotation.some(function (v, i) { return (Math.floor(i / 4) >= dimension || i % 4 >= dimension) && Math.abs(v - identity[i]) > 1e-12; })) {
      throw new Error('旋转必须保持基底子空间，且 det=+1');
    }
    var base = (dimension === 3 ? tetra : triangle).map(function (p) { return M4.scale(M4.mulVec(rotation, p), scale); });
    return { dimension: dimension, scale: scale, base: base,
      edge: (dimension === 3 ? Math.sqrt(8) : Math.sqrt(3)) * scale,
      radius: (dimension === 3 ? Math.sqrt(3) : 1) * scale };
  }
  function bound(model) {
    var rho = model.radius / model.edge;
    return (1 - rho) / (4 * rho - 1);
  }
  function best(model, vertex) {
    vertex = vertex === undefined ? 0 : vertex;
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= model.base.length) throw new Error('无效材料点编号');
    // 最优点在面外，不在质心：一条偏长、其余偏短，最大绝对误差恰好平衡。
    return M4.scale(model.base[vertex], -4 * bound(model));
  }
  function exact(model, sign) {
    if (sign !== 1 && sign !== -1) throw new Error('精确解的符号必须为 ±1');
    var p = [0, 0, 0, 0];
    p[model.dimension] = sign * Math.sqrt(model.edge * model.edge - model.radius * model.radius);
    return p;
  }
  function measure(model, p) {
    point(p);
    var points = model.base.concat([p]), rows = [], maxError = 0;
    for (var i = 0; i < points.length; i++) for (var j = i + 1; j < points.length; j++) {
      var distance = M4.len(M4.sub(points[i], points[j]));
      var error = (distance - model.edge) / model.edge;
      rows.push({ a: i, b: j, distance: distance, error: error });
      maxError = Math.max(maxError, Math.abs(error));
    }
    return { points: points, rows: rows, maxError: maxError, success: maxError <= 0.01,
      exact: maxError <= 16 * Number.EPSILON };
  }
  function recoverProjection(model, p) {
    point(p);
    var squared = model.base.map(function (v) { var d = M4.sub(p, v); return M4.dot(d, d); });
    var result = [0, 0, 0, 0];
    // Σvᵢ=0 且 Σvᵢvᵢᵀ=(L²/2)I，故 p_parallel=−Σdᵢ²vᵢ/L²。
    model.base.forEach(function (v, i) { result = M4.add(result, M4.scale(v, -squared[i] / (model.edge * model.edge))); });
    return result;
  }
  function cornerCertificate(dimension, error, highCount) {
    var n = dimension + 1, k = highCount;
    if ((dimension !== 2 && dimension !== 3) || !Number.isFinite(error) || error < 0 ||
        !Number.isInteger(k) || k < 0 || k > n) throw new Error('无效下界证书参数');
    // 凸二次式在距离平方的盒子顶点取最大值；全负就排除了基底空间中的所有点。
    return (8 * k * (n - k) - n) * error * error - 2 * (2 * k - n) * error - (n + 1) / 2;
  }
  global.Simplex4 = { tetra: tetra, triangle: triangle, create: create, bound: bound, best: best,
    exact: exact, measure: measure, recoverProjection: recoverProjection, cornerCertificate: cornerCertificate };
})(window);

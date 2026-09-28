/* A02 的路径只平移整环；材料参数不随相机、距离检测或播放进度重新配对。 */
(function (global) {
  'use strict';
  var TAU = 2 * Math.PI, rho = 0.1, count = 96;
  function range(value, lo, hi, name) {
    if (!Number.isFinite(value) || value < lo || value > hi) throw new Error(name + ' 超出范围');
  }
  function checkPose(p) {
    range(p.x, 0, 3, 'x 位移'); range(p.w, 0, 1, 'w 位移');
  }
  function pointA(u) { return [Math.cos(u), Math.sin(u), 0, 0]; }
  function pointB(v, p) { return [1 + Math.cos(v) + p.x, 0, Math.sin(v), p.w]; }
  function path(t, omitTranslation) {
    range(t, 0, 3, '路径进度');
    var stage = t < 1 ? 1 : t < 2 ? 2 : 3;
    var x = omitTranslation ? 0 : 3 * Math.max(0, Math.min(1, t - 1));
    var w = t < 1 ? t : t < 2 ? 1 : 3 - t;
    var bound = stage === 1 || omitTranslation ? Math.hypot(1, w) : stage === 2 ? 1 : 2;
    return { x: x, w: w, stage: stage, bound: bound };
  }
  var angles = [], a = [], b = [], edges = [];
  for (var i = 0; i < count; i++) {
    angles.push(TAU * i / count);
    a.push(Object.freeze(pointA(angles[i])));
    b.push(Object.freeze(pointB(angles[i], { x: 0, w: 0 })));
    edges.push(Object.freeze([i, (i + 1) % count]));
  }
  function rings(p) {
    checkPose(p);
    return { a: a, b: b.map(function (v) { return M4.add(v, [p.x, 0, 0, p.w]); }) };
  }
  function minimum(p) {
    checkPose(p);
    // A02 这族姿态中 c=1+x≥1；对 cos(u)、cos(v) 依次取极值，
    // 最近点可始终取 u=0、v=π。读数仍从该对材料坐标计算，不从下界回填。
    var pa = pointA(0), pb = pointB(Math.PI, p);
    return { u: 0, v: Math.PI, a: pa, b: pb, distance: M4.len(M4.sub(pa, pb)),
      projected: Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) };
  }
  function clamp(t) { return Math.max(0, Math.min(1, t)); }
  function segmentDistance(a0, a1, b0, b1) {
    var u = M4.sub(a1, a0), v = M4.sub(b1, b0), r = M4.sub(a0, b0);
    var aa = M4.dot(u, u), bb = M4.dot(v, v), ab = M4.dot(u, v);
    var ar = M4.dot(u, r), br = M4.dot(v, r), best = Infinity, bs = 0, bt = 0;
    function candidate(s, t) {
      var d2 = 0;
      for (var k = 0; k < 4; k++) { var d = r[k] + s * u[k] - t * v[k]; d2 += d * d; }
      if (d2 < best) { best = d2; bs = s; bt = t; }
    }
    // 距离平方是凸二次式：内部驻点及四条边覆盖最小值，退化线段也走边界。
    candidate(0, bb ? clamp(br / bb) : 0);
    candidate(1, bb ? clamp((br + ab) / bb) : 0);
    candidate(aa ? clamp(-ar / aa) : 0, 0);
    candidate(aa ? clamp((ab - ar) / aa) : 0, 1);
    var det = aa * bb - ab * ab;
    if (det > 0) {
      var s = (ab * br - bb * ar) / det, t = (aa * br - ab * ar) / det;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1) candidate(s, t);
    }
    return { distance: Math.sqrt(best), s: bs, t: bt,
      a: M4.add(a0, M4.scale(u, bs)), b: M4.add(b0, M4.scale(v, bt)) };
  }
  function capsuleDistance(ps) {
    var best = null;
    edges.forEach(function (ea, i) {
      edges.forEach(function (eb, j) {
        var d = segmentDistance(ps.a[ea[0]], ps.a[ea[1]], ps.b[eb[0]], ps.b[eb[1]]);
        if (!best || d.distance < best.distance) { best = d; best.edgeA = i; best.edgeB = j; }
      });
    });
    // 弦不等于圆弧；两条曲线的距离误差至多为两倍弓高，不能把折线值冒充精确值。
    var error = 2 * (1 - Math.cos(Math.PI / count));
    best.curveLower = Math.max(0, best.distance - error);
    best.curveUpper = best.distance + error;
    best.gap = best.distance - 2 * rho;
    return best;
  }
  function pull3(requested) {
    range(requested, 0, 3, '三维请求位移');
    // 沿整条 x 拉动路径，首次接触在 x=1-2ρ；即使请求终点已经分离也不能跳过去。
    var contact = 1 - 2 * rho;
    return { x: Math.min(requested, contact), w: 0, requested: requested, contact: requested >= contact };
  }
  global.Rings4 = Object.freeze({
    rho: rho, count: count, angles: Object.freeze(angles),
    a: Object.freeze(a), b: Object.freeze(b), edges: Object.freeze(edges),
    pointA: pointA, pointB: pointB, path: path, rings: rings, minimum: minimum,
    segmentDistance: segmentDistance, capsuleDistance: capsuleDistance, pull3: pull3,
    crossingTime: 4 / 3
  });
})(window);

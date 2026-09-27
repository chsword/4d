/* polytopes.js —— 一批四维图形的顶点 / 棱表
 *
 * 每个构造函数返回：
 *   { name, verts: [[x,y,z,w], ...], edges: [[i,j], ...], projection?: 'stereographic' }
 *
 * 正则四维多胞体一共只有 6 个（3D 是 5 个柏拉图立体）：
 *   5-cell(单纯形) 8-cell(超立方) 16-cell 24-cell 120-cell 600-cell
 * 这里实现了前四个 —— 后两个顶点/棱数量太大（120-cell 有 600 顶点
 * 1200 棱），线框看上去只是一团毛球，教学价值反而低。
 */
(function (global) {
  'use strict';

  /* 由顶点表 + "棱长平方" 自动连边：取所有距离最短的顶点对。
     正则多胞体的最短顶点距离就是棱长，这个办法省掉手写棱表。 */
  function edgesByNearest(verts, tol) {
    tol = tol || 1e-6;
    var best = Infinity, i, j, d;
    for (i = 0; i < verts.length; i++) {
      for (j = i + 1; j < verts.length; j++) {
        d = dist2(verts[i], verts[j]);
        if (d > tol && d < best) best = d;
      }
    }
    var out = [];
    for (i = 0; i < verts.length; i++) {
      for (j = i + 1; j < verts.length; j++) {
        if (Math.abs(dist2(verts[i], verts[j]) - best) < 1e-6) out.push([i, j]);
      }
    }
    return out;
  }

  function dist2(a, b) {
    var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2], w = a[3] - b[3];
    return x * x + y * y + z * z + w * w;
  }

  /* 8-cell / 超立方体 / tesseract：16 顶点，32 棱，24 正方形面，8 个立方体胞 */
  function tesseract() {
    var verts = [], edges = [], i, b;
    for (i = 0; i < 16; i++) {
      verts.push([
        (i & 1) ? 1 : -1,
        (i & 2) ? 1 : -1,
        (i & 4) ? 1 : -1,
        (i & 8) ? 1 : -1
      ]);
    }
    // 二进制编号只差一位的两个顶点之间有棱
    for (i = 0; i < 16; i++) {
      for (b = 0; b < 4; b++) {
        var j = i ^ (1 << b);
        if (j > i) edges.push([i, j]);
      }
    }
    return { name: '8-cell 超立方体', verts: verts, edges: edges };
  }

  /* 16-cell：8 顶点（±e_i），24 棱。超立方体的对偶。 */
  function cell16() {
    var verts = [], a, s;
    for (a = 0; a < 4; a++) {
      for (s = -1; s <= 1; s += 2) {
        var v = [0, 0, 0, 0];
        v[a] = s;
        verts.push(v);
      }
    }
    return { name: '16-cell 超八面体', verts: verts, edges: edgesByNearest(verts) };
  }

  /* 24-cell：24 顶点（(±1,±1,0,0) 的所有排列），96 棱。
     四维独有 —— 3D 没有任何柏拉图立体与它类比，它自己是自对偶的。 */
  function cell24() {
    var verts = [], a, b, sa, sb;
    for (a = 0; a < 4; a++) {
      for (b = a + 1; b < 4; b++) {
        for (sa = -1; sa <= 1; sa += 2) {
          for (sb = -1; sb <= 1; sb += 2) {
            var v = [0, 0, 0, 0];
            v[a] = sa; v[b] = sb;
            verts.push(v);
          }
        }
      }
    }
    return { name: '24-cell 正二十四胞体', verts: verts, edges: edgesByNearest(verts) };
  }

  /* 5-cell / 四维单纯形：5 个两两等距的点。
     做法：R⁵ 里的 5 个基向量落在超平面 Σx = 1 上本来就构成正单纯形，
     再把这个超平面的一组正交基当成 R⁴ 的坐标轴。 */
  function cell5() {
    var e = [];
    var i, j, k;
    for (i = 0; i < 5; i++) {
      var v = [0, 0, 0, 0, 0];
      v[i] = 1;
      e.push(v);
    }
    var center = [0.2, 0.2, 0.2, 0.2, 0.2];
    // 超平面 Σx = 1 内的 4 个正交基（对 e_i - center 做 Gram-Schmidt）
    var basis = [];
    for (i = 0; i < 5 && basis.length < 4; i++) {
      var u = e[i].map(function (x, n) { return x - center[n]; });
      for (j = 0; j < basis.length; j++) {
        var d = 0;
        for (k = 0; k < 5; k++) d += u[k] * basis[j][k];
        for (k = 0; k < 5; k++) u[k] -= d * basis[j][k];
      }
      var l = Math.sqrt(u.reduce(function (s, x) { return s + x * x; }, 0));
      if (l > 1e-8) basis.push(u.map(function (x) { return x / l; }));
    }
    var verts = e.map(function (p) {
      var q = p.map(function (x, n) { return x - center[n]; });
      return basis.map(function (bv) {
        var s = 0;
        for (var n = 0; n < 5; n++) s += q[n] * bv[n];
        return s * 2.2;          // 放大到和别的图形差不多的尺寸
      });
    });
    return { name: '5-cell 四维单纯形', verts: verts, edges: edgesByNearest(verts) };
  }

  /* p×q 双棱柱（duoprism）：两个多边形的笛卡尔积。
     6×6 的那个是理解 "两个独立旋转平面" 最好的教具：
     xy 平面转动第一个圈，zw 平面转动第二个圈，互不干扰。 */
  function duoprism(p, q) {
    var verts = [], edges = [], i, j;
    for (i = 0; i < p; i++) {
      for (j = 0; j < q; j++) {
        var a = 2 * Math.PI * i / p, b = 2 * Math.PI * j / q;
        verts.push([Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)]);
      }
    }
    var idx = function (i, j) { return ((i % p) + p) % p * q + ((j % q) + q) % q; };
    for (i = 0; i < p; i++) {
      for (j = 0; j < q; j++) {
        edges.push([idx(i, j), idx(i + 1, j)]);
        edges.push([idx(i, j), idx(i, j + 1)]);
      }
    }
    return { name: p + '×' + q + ' 双棱柱', verts: verts, edges: edges };
  }

  /* Clifford 环面：S³ 里 |(x,y)| = |(z,w)| = 1/√2 的那张曲面。
     它把 S³ 干净地切成两个全等的实心环 —— 四维里"内外"没有意义的直观证据。 */
  function cliffordTorus(n, m) {
    var verts = [], edges = [], i, j;
    var r = Math.SQRT1_2;
    for (i = 0; i < n; i++) {
      for (j = 0; j < m; j++) {
        var a = 2 * Math.PI * i / n, b = 2 * Math.PI * j / m;
        verts.push([r * Math.cos(a), r * Math.sin(a), r * Math.cos(b), r * Math.sin(b)]);
      }
    }
    var idx = function (i, j) { return ((i % n) + n) % n * m + ((j % m) + m) % m; };
    for (i = 0; i < n; i++) {
      for (j = 0; j < m; j++) {
        edges.push([idx(i, j), idx(i + 1, j)]);
        edges.push([idx(i, j), idx(i, j + 1)]);
      }
    }
    return { name: 'Clifford 环面', verts: verts, edges: edges, projection: 'stereographic' };
  }

  /* Hopf 纤维化：S² 上每个点对应 S³ 里的一整个圆。
     立体投影到 R³ 之后，这些圆两两套扣却永不相交 —— 全靠第四维躲开。
     基球面上取一圈纬线，得到一族互相缠绕的环。 */
  function hopf(rings, perRing, ringsPerBand) {
    var verts = [], edges = [], i, j, k;
    ringsPerBand = ringsPerBand || 3;
    var base = [];
    for (k = 1; k <= ringsPerBand; k++) {
      var theta = Math.PI * k / (ringsPerBand + 1);      // 纬度
      for (i = 0; i < rings; i++) {
        var phi = 2 * Math.PI * i / rings;
        base.push([
          Math.sin(theta) * Math.cos(phi),
          Math.sin(theta) * Math.sin(phi),
          Math.cos(theta)
        ]);
      }
    }
    for (k = 0; k < base.length; k++) {
      var a = base[k][0], b = base[k][1], c = base[k][2];
      var s = Math.sqrt(2 * (1 + c));
      if (s < 1e-6) continue;
      var start = verts.length;
      for (j = 0; j < perRing; j++) {
        var t = 2 * Math.PI * j / perRing;
        var ct = Math.cos(t), st = Math.sin(t);
        verts.push([
          (1 + c) * ct / s,
          (a * st - b * ct) / s,
          (a * ct + b * st) / s,
          (1 + c) * st / s
        ]);
        edges.push([start + j, start + (j + 1) % perRing]);
      }
    }
    return { name: 'Hopf 纤维化', verts: verts, edges: edges, projection: 'stereographic' };
  }

  global.Polytopes = {
    tesseract: tesseract,
    cell16: cell16,
    cell24: cell24,
    cell5: cell5,
    duoprism: duoprism,
    cliffordTorus: cliffordTorus,
    hopf: hopf,
    build: function (key) {
      switch (key) {
        case 'tesseract': return tesseract();
        case '16cell': return cell16();
        case '24cell': return cell24();
        case '5cell': return cell5();
        case 'duoprism': return duoprism(6, 6);
        case 'clifford': return cliffordTorus(16, 16);
        case 'hopf': return hopf(8, 48, 3);
        default: return tesseract();
      }
    }
  };
})(window);

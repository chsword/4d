/* view-analogy.js —— 降维类比：先看懂 3D→2D，再把整套话搬去 4D→3D
 *
 * 人对四维没有直觉，但对三维有。所以最有效的教法是先把同一套操作
 * 在低一维上做一遍：
 *
 *   平面国的居民（2D）  ←→  我们（3D）
 *   立方体穿过他的平面   ←→  超立方体穿过我们的空间
 *   他看到一个变形的多边形 ←→ 我们看到一个变形的多面体
 *
 * 四块面板：
 *   A  立方体 + 那张切割平面（我们这个三维视角看得见全貌）
 *   B  平面人视角：他只看到那个多边形
 *   C  同一个操作升一维：超立方体被超平面 w=k 切出来的三维多面体
 *   D  胶片：k 连续变化时，截面这一串形状 —— 这就是"整个四维物体"
 */
(function (global) {
  'use strict';

  /* ---------- 立方体 ---------- */
  var CUBE_V = [];
  for (var i = 0; i < 8; i++) {
    CUBE_V.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1]);
  }
  var CUBE_E = [];
  for (i = 0; i < 8; i++) {
    for (var b = 0; b < 3; b++) { var j = i ^ (1 << b); if (j > i) CUBE_E.push([i, j]); }
  }
  /* 6 个面，每个面记 4 条棱（按顶点对） */
  var CUBE_F = (function () {
    var faces = [];
    for (var ax = 0; ax < 3; ax++) {
      for (var s = 0; s < 2; s++) {
        var vs = [];
        for (var k = 0; k < 8; k++) {
          var bit = (k >> ax) & 1;
          if (bit === s) vs.push(k);
        }
        var es = [];
        for (var a = 0; a < vs.length; a++) {
          for (var c = a + 1; c < vs.length; c++) {
            var d = 0, p = CUBE_V[vs[a]], q = CUBE_V[vs[c]];
            for (var t = 0; t < 3; t++) if (p[t] !== q[t]) d++;
            if (d === 1) es.push([vs[a], vs[c]]);
          }
        }
        faces.push(es);
      }
    }
    return faces;
  })();

  /* ---------- 超立方体：16 顶点 / 32 棱 / 24 个正方形面 ---------- */
  var TES = Polytopes.tesseract();
  var TES_F = (function () {
    /* 一个正方形面 = 挑 2 个轴自由变动、另 2 个轴取定值 */
    var faces = [], ax = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (var f = 0; f < ax.length; f++) {
      var free = ax[f];
      var fixed = [0, 1, 2, 3].filter(function (x) { return free.indexOf(x) < 0; });
      for (var s = 0; s < 4; s++) {
        var vs = [];
        for (var v = 0; v < 16; v++) {
          var ok = true;
          for (var t = 0; t < 2; t++) {
            var bit = (v >> fixed[t]) & 1;
            if (bit !== ((s >> t) & 1)) { ok = false; break; }
          }
          if (ok) vs.push(v);
        }
        var es = [];
        for (var a = 0; a < vs.length; a++) {
          for (var c = a + 1; c < vs.length; c++) {
            if (popcount(vs[a] ^ vs[c]) === 1) es.push([vs[a], vs[c]]);
          }
        }
        faces.push(es);
      }
    }
    return faces;
  })();

  function popcount(n) { var c = 0; while (n) { c += n & 1; n >>= 1; } return c; }

  /* 用超平面（第 axis 个坐标 = k）切一个"顶点 + 面（面记棱表）"结构。
     每个二维面被超平面切出一条线段，把这些线段拼起来就是截面的线框。 */
  function sliceFaces(verts, faces, axis, k) {
    var segs = [];
    for (var f = 0; f < faces.length; f++) {
      var pts = [];
      var es = faces[f];
      for (var e = 0; e < es.length; e++) {
        var A = verts[es[e][0]], B = verts[es[e][1]];
        var da = A[axis] - k, db = B[axis] - k;
        if ((da < 0 && db < 0) || (da > 0 && db > 0)) continue;
        if (Math.abs(da - db) < 1e-9) continue;
        var t = da / (da - db);
        var p = [];
        for (var c = 0; c < A.length; c++) p.push(A[c] + (B[c] - A[c]) * t);
        pts.push(p);
      }
      if (pts.length >= 2) segs.push([pts[0], pts[1]]);
      if (pts.length >= 4) segs.push([pts[2], pts[3]]);
    }
    return segs;
  }

  /* ---------- 3x3 旋转 ---------- */
  function rot3(yaw, pitch, roll) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cr = Math.cos(roll), sr = Math.sin(roll);
    return function (p) {
      var x = p[0] * cr - p[1] * sr, y = p[0] * sr + p[1] * cr, z = p[2];
      var x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      var y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      return [x1, y1, z2];
    };
  }

  function AnalogyView(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.k = 0.0;              // 切割位置
    this.autoK = true;
    this.t = 0;
    this.spin = true;
    this.cubeYaw = 0.5;
    this.cubePitch = 0.35;
    this.cubeRoll = 0.2;
  }

  AnalogyView.prototype.step = function (dt) {
    this.t += dt;
    if (this.spin) {
      this.cubeYaw += dt * 0.35;
      this.cubePitch += dt * 0.21;
      this.cubeRoll += dt * 0.13;
    }
    if (this.autoK) this.k = Math.sin(this.t * 0.55) * 1.45;
  };

  AnalogyView.prototype.draw = function () {
    var ctx = this.ctx, cv = this.canvas;
    var W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0c14';
    ctx.fillRect(0, 0, W, H);

    var cols = W > H * 1.1 ? 2 : 1;
    var rows = cols === 2 ? 2 : 4;
    var pw = W / cols, ph = H / rows;
    var panels = [
      this._panelCube3D, this._panelFlatlander,
      this._panelTesseractSlice, this._panelFilmstrip
    ];
    for (var i = 0; i < panels.length; i++) {
      var cx = (i % cols) * pw, cyy = Math.floor(i / cols) * ph;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx + 1, cyy + 1, pw - 2, ph - 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(120,150,200,.18)';
      ctx.strokeRect(cx + 1.5, cyy + 1.5, pw - 3, ph - 3);
      panels[i].call(this, ctx, cx, cyy, pw, ph);
      ctx.restore();
    }
  };

  AnalogyView.prototype._label = function (ctx, x, y, title, sub) {
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(180,205,240,.92)';
    ctx.fillText(title, x + 12, y + 20);
    if (sub) {
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(150,170,200,.65)';
      ctx.fillText(sub, x + 12, y + 36);
    }
  };

  /* A —— 我们的视角：立方体全貌 + 那张平面 */
  AnalogyView.prototype._panelCube3D = function (ctx, x, y, w, h) {
    var R = rot3(this.cubeYaw, this.cubePitch, this.cubeRoll);
    var S = Math.min(w, h) * 0.22, ox = x + w / 2, oy = y + h / 2 + 10;
    var dist = 5.5;
    function pr(p) {
      var zc = p[2] + dist;
      if (zc < 0.2) zc = 0.2;
      var kk = dist / zc;
      return [ox + p[0] * kk * S, oy - p[1] * kk * S, zc];
    }
    var V = CUBE_V.map(R), i;
    var P = V.map(pr);

    // 平面 y = k
    var plane = [[-2.3, this.k, -2.3], [2.3, this.k, -2.3], [2.3, this.k, 2.3], [-2.3, this.k, 2.3]];
    var pp = plane.map(function (p) { return pr(p); });
    ctx.beginPath();
    ctx.moveTo(pp[0][0], pp[0][1]);
    for (i = 1; i < 4; i++) ctx.lineTo(pp[i][0], pp[i][1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(80,190,255,.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,190,255,.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 立方体线框
    ctx.strokeStyle = 'rgba(170,195,235,.55)';
    ctx.lineWidth = 1.3;
    for (i = 0; i < CUBE_E.length; i++) {
      var a = P[CUBE_E[i][0]], b = P[CUBE_E[i][1]];
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // 截面（在我们眼里就是立方体上的一圈亮线）
    var segs = sliceFaces(V, CUBE_F, 1, this.k);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2.4;
    for (i = 0; i < segs.length; i++) {
      var s0 = pr(segs[i][0]), s1 = pr(segs[i][1]);
      ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke();
    }

    this._label(ctx, x, y, 'A · 三维观察者（我们）',
      '看得到立方体全貌，也看得到那张平面  y = ' + this.k.toFixed(2));
  };

  /* B —— 平面人的视角：他只有这个多边形 */
  AnalogyView.prototype._panelFlatlander = function (ctx, x, y, w, h) {
    var R = rot3(this.cubeYaw, this.cubePitch, this.cubeRoll);
    var V = CUBE_V.map(R);
    var segs = sliceFaces(V, CUBE_F, 1, this.k);
    var S = Math.min(w, h) * 0.26, ox = x + w / 2, oy = y + h / 2 + 10;

    // 平面人的坐标系就是 (x, z)
    ctx.strokeStyle = 'rgba(120,150,200,.13)';
    ctx.lineWidth = 1;
    for (var g = -3; g <= 3; g++) {
      ctx.beginPath();
      ctx.moveTo(ox + g * S * 0.5, oy - 3 * S * 0.5); ctx.lineTo(ox + g * S * 0.5, oy + 3 * S * 0.5);
      ctx.moveTo(ox - 3 * S * 0.5, oy + g * S * 0.5); ctx.lineTo(ox + 3 * S * 0.5, oy + g * S * 0.5);
      ctx.stroke();
    }

    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (var i = 0; i < segs.length; i++) {
      var a = segs[i][0], b = segs[i][1];
      ctx.beginPath();
      ctx.moveTo(ox + a[0] * S, oy - a[2] * S);
      ctx.lineTo(ox + b[0] * S, oy - b[2] * S);
      ctx.stroke();
    }
    var note = segs.length === 0
      ? '什么都没有 —— 立方体整个在平面之外'
      : segs.length + ' 条边的多边形，边数还会随立方体转动而变';
    this._label(ctx, x, y, 'B · 二维观察者（平面人）', note);
  };

  /* C —— 完全同一个操作，升一维：超立方体 ∩ 超平面 w = k */
  AnalogyView.prototype._panelTesseractSlice = function (ctx, x, y, w, h) {
    var R = M4.compose([
      M4.rotation('xw', this.t * 0.31),
      M4.rotation('yz', this.t * 0.22),
      M4.rotation('zw', this.t * 0.17)
    ]);
    var V = TES.verts.map(function (v) { return M4.mulVec(R, v); });
    var segs = sliceFaces(V, TES_F, 3, this.k);      // 按第 3 个坐标（w）切

    var S = Math.min(w, h) * 0.2, ox = x + w / 2, oy = y + h / 2 + 12, dist = 6;
    var yaw = 0.7, pitch = -0.3;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    function pr(p) {
      var x1 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
      var y1 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
      var zc = z2 + dist; if (zc < 0.2) zc = 0.2;
      var kk = dist / zc;
      return [ox + x1 * kk * S, oy - y1 * kk * S, zc];
    }
    ctx.strokeStyle = '#7ad4ff';
    ctx.lineWidth = 2.1;
    for (var i = 0; i < segs.length; i++) {
      var a = pr(segs[i][0]), b = pr(segs[i][1]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    this._label(ctx, x, y, 'C · 三维观察者看四维物体',
      '超立方体 ∩ 超平面 w = ' + this.k.toFixed(2) + ' → 一个三维多面体（' + segs.length + ' 条棱）');
  };

  /* D —— 胶片：把 k 扫一遍，"整个四维物体"就是这一串三维形状 */
  AnalogyView.prototype._panelFilmstrip = function (ctx, x, y, w, h) {
    var R = M4.compose([
      M4.rotation('xw', this.t * 0.31),
      M4.rotation('yz', this.t * 0.22),
      M4.rotation('zw', this.t * 0.17)
    ]);
    var V = TES.verts.map(function (v) { return M4.mulVec(R, v); });
    var N = 7, i, n;
    var cellW = (w - 24) / N, S = Math.min(cellW, h * 0.3) * 0.34;
    var yaw = 0.7, pitch = -0.3;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);

    for (n = 0; n < N; n++) {
      var kk = -1.7 + 3.4 * n / (N - 1);
      var segs = sliceFaces(V, TES_F, 3, kk);
      var ox = x + 12 + cellW * (n + 0.5), oy = y + h * 0.58;
      var active = Math.abs(kk - this.k) < 3.4 / (N - 1) / 2;
      ctx.strokeStyle = active ? '#ffd24a' : 'rgba(122,212,255,.55)';
      ctx.lineWidth = active ? 1.8 : 1.1;
      for (i = 0; i < segs.length; i++) {
        var pa = segs[i][0], pb = segs[i][1], out = [];
        [pa, pb].forEach(function (p) {
          var x1 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
          var y1 = p[1] * cp - z1 * sp;
          out.push([ox + x1 * S, oy - y1 * S]);
        });
        ctx.beginPath(); ctx.moveTo(out[0][0], out[0][1]); ctx.lineTo(out[1][0], out[1][1]); ctx.stroke();
      }
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = active ? 'rgba(255,210,74,.9)' : 'rgba(150,170,200,.5)';
      ctx.textAlign = 'center';
      ctx.fillText('w=' + kk.toFixed(1), ox, y + h - 16);
      ctx.textAlign = 'left';
    }
    this._label(ctx, x, y, 'D · 一整个四维物体',
      '它不是"一个形状"，而是这一串三维形状的全体');
  };

  global.AnalogyView = AnalogyView;
  /* 截面算法本身是通用的（任意维、任意"顶点+二维面"结构），单独暴露出来便于测试和复用 */
  AnalogyView.sliceFaces = sliceFaces;
  AnalogyView.CUBE = { verts: CUBE_V, edges: CUBE_E, faces: CUBE_F };
  AnalogyView.TESSERACT = { verts: TES.verts, edges: TES.edges, faces: TES_F };
})(window);

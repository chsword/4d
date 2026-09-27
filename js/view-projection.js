/* view-projection.js —— 手法 A：投影法
 *
 * 流水线：4D 顶点 --(M4 旋转)--> 4D --(透视/正交/立体投影)--> 3D
 *         --(可拖动的 3D 相机)--> 2D 画布
 *
 * 两级投影是不可回避的：屏幕是 2D，所以 4→2 必须降两次维。
 * 好处是能一眼看到整个形状的拓扑；代价是尺寸和角度全被扭曲
 * （超立方体的 8 个胞全是全等的正方体，图上却大小悬殊）。
 */
(function (global) {
  'use strict';

  function ProjectionView(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.shape = Polytopes.build('tesseract');
    this.mode = 'perspective';      // perspective | ortho | stereographic
    this.eye = 2.6;                 // 第四维上的视距
    this.speeds = { xy: 0, xz: 0, yz: 0, xw: 0.25, yw: 0, zw: 0.15 };
    this.angles = { xy: 0, xz: 0, yz: 0, xw: 0, yw: 0, zw: 0 };
    this.camYaw = 0.6;
    this.camPitch = -0.25;
    this.camDist = 6.5;
    this.colorByW = true;
    this.showVerts = true;
    this.dragging = false;
    this._bindMouse();
  }

  ProjectionView.prototype._bindMouse = function () {
    var self = this, last = null;
    this.canvas.addEventListener('pointerdown', function (e) {
      self.dragging = true; last = [e.clientX, e.clientY];
      self.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointerup', function () { self.dragging = false; });
    this.canvas.addEventListener('pointermove', function (e) {
      if (!self.dragging || !last) return;
      self.camYaw += (e.clientX - last[0]) * 0.008;
      self.camPitch += (e.clientY - last[1]) * 0.008;
      self.camPitch = Math.max(-1.5, Math.min(1.5, self.camPitch));
      last = [e.clientX, e.clientY];
    });
    this.canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.camDist = Math.max(2.5, Math.min(20, self.camDist * (1 + e.deltaY * 0.001)));
    }, { passive: false });
  };

  ProjectionView.prototype.setShape = function (key) {
    this.shape = Polytopes.build(key);
    if (this.shape.projection === 'stereographic') this.mode = 'stereographic';
    else if (this.mode === 'stereographic') this.mode = 'perspective';
  };

  ProjectionView.prototype.step = function (dt) {
    for (var p in this.speeds) {
      this.angles[p] += this.speeds[p] * dt;
    }
  };

  /* 6 个旋转平面按固定顺序合成一个 4x4。
     顺序有意义（4D 旋转不交换），这里的选择只求视觉上连续。 */
  ProjectionView.prototype.rotor = function () {
    var order = ['xy', 'xz', 'yz', 'xw', 'yw', 'zw'], mats = [];
    for (var i = 0; i < order.length; i++) {
      mats.push(M4.rotation(order[i], this.angles[order[i]]));
    }
    return M4.compose(mats);
  };

  ProjectionView.prototype.draw = function () {
    var ctx = this.ctx, cv = this.canvas;
    var W = cv.width, H = cv.height, S = Math.min(W, H) * 0.42;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0c14';
    ctx.fillRect(0, 0, W, H);

    var R = this.rotor();
    var verts = this.shape.verts, edges = this.shape.edges;
    var n = verts.length, i;

    // 第一级：4D 旋转 + 4D→3D
    var p3 = new Array(n), wRaw = new Array(n);
    var wMin = Infinity, wMax = -Infinity;
    for (i = 0; i < n; i++) {
      var v = M4.mulVec(R, verts[i]);
      wRaw[i] = v[3];
      if (v[3] < wMin) wMin = v[3];
      if (v[3] > wMax) wMax = v[3];
      if (this.mode === 'perspective') {
        p3[i] = M4.project4to3(v, this.eye);
      } else if (this.mode === 'stereographic') {
        // 立体投影只对 S³ 上的点有定义，所以先把顶点径向推到单位球面；
        // 再整体缩小一半，否则靠近北极的点会被放大十几倍飞出画面。
        var q = M4.stereo4to3(M4.normalize(v));
        p3[i] = [q[0] * 0.5, q[1] * 0.5, q[2] * 0.5, q[3]];
      } else {
        p3[i] = M4.ortho4to3(v);
      }
    }
    if (wMax - wMin < 1e-6) wMax = wMin + 1e-6;

    // 第二级：3D 相机 + 3D→2D
    var cy = Math.cos(this.camYaw), sy = Math.sin(this.camYaw);
    var cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    var p2 = new Array(n), depth = new Array(n);
    for (i = 0; i < n; i++) {
      var x = p3[i][0], y = p3[i][1], z = p3[i][2];
      var x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      var y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      var zc = z2 + this.camDist;
      if (zc < 0.15) zc = 0.15;
      var k = this.camDist / zc;
      p2[i] = [W / 2 + x1 * k * S, H / 2 - y1 * k * S];
      depth[i] = zc;
    }

    // 远的先画，近的后画 —— 廉价但足够用的深度排序
    var order = edges.slice().sort(function (a, b) {
      return (depth[b[0]] + depth[b[1]]) - (depth[a[0]] + depth[a[1]]);
    });

    ctx.lineCap = 'round';
    for (i = 0; i < order.length; i++) {
      var e = order[i], a = e[0], b = e[1];
      var seg = Math.abs(p2[a][0] - p2[b][0]) + Math.abs(p2[a][1] - p2[b][1]);
      if (seg > W * 1.6) continue;      // 被投影拉爆的棱，画出来只是噪声
      var wm = ((wRaw[a] + wRaw[b]) / 2 - wMin) / (wMax - wMin);   // 0..1
      var dm = (depth[a] + depth[b]) / 2;
      var near = Math.max(0.15, Math.min(1, this.camDist / dm));

      if (this.colorByW) {
        // 色相编码第四维坐标：暖色 = w 大（"朝我们这边"），冷色 = w 小
        var hue = 210 - wm * 190;
        ctx.strokeStyle = 'hsla(' + hue + ',85%,' + (45 + wm * 22) + '%,' + (0.35 + near * 0.6) + ')';
      } else {
        ctx.strokeStyle = 'rgba(180,210,255,' + (0.25 + near * 0.65) + ')';
      }
      ctx.lineWidth = (0.6 + wm * 2.2) * near;
      ctx.beginPath();
      ctx.moveTo(p2[a][0], p2[a][1]);
      ctx.lineTo(p2[b][0], p2[b][1]);
      ctx.stroke();
    }

    if (this.showVerts && n <= 200) {
      for (i = 0; i < n; i++) {
        var wn = (wRaw[i] - wMin) / (wMax - wMin);
        var nz = Math.max(0.2, Math.min(1, this.camDist / depth[i]));
        ctx.fillStyle = this.colorByW
          ? 'hsla(' + (210 - wn * 190) + ',90%,70%,' + (0.4 + nz * 0.6) + ')'
          : 'rgba(230,240,255,' + (0.4 + nz * 0.6) + ')';
        ctx.beginPath();
        ctx.arc(p2[i][0], p2[i][1], (1.2 + wn * 2.4) * nz, 0, 6.2832);
        ctx.fill();
      }
    }

    this._legend(ctx, W, H, wMin, wMax);
  };

  ProjectionView.prototype._legend = function (ctx, W, H, wMin, wMax) {
    if (!this.colorByW) return;
    var x = 16, y = H - 34, bw = 150, bh = 10;
    for (var i = 0; i < bw; i++) {
      ctx.fillStyle = 'hsl(' + (210 - (i / bw) * 190) + ',85%,58%)';
      ctx.fillRect(x + i, y, 1, bh);
    }
    ctx.fillStyle = 'rgba(200,215,235,.75)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('w = ' + wMin.toFixed(2), x, y - 5);
    ctx.fillText(wMax.toFixed(2), x + bw - 26, y - 5);
    ctx.fillText(this.shape.name + '  ·  ' + this.shape.verts.length + ' 顶点 / ' +
      this.shape.edges.length + ' 棱', x, y + bh + 14);
  };

  global.ProjectionView = ProjectionView;
})(window);

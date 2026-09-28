/* 只给一个胞轻填色；本地尺与接缝材料点补足透视图不能提供的尺寸证据。 */
(function (global) {
  'use strict';
  var N = Net4, colors = ['#8dd5ff', '#e9a976', '#adce8c', '#ccafe8', '#f3d16e', '#8ad5bf', '#e3a3b1', '#a9b8fa'];
  function NetView(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('浏览器未能创建 Canvas 2D');
    this.t = 0; this.selected = 0; this.playing = false; this.stageInspected = false;
    this.camYaw = 0.6; this.camPitch = -0.35; this.mode = 'perspective';
    this.seams = N.seams(); this.seam = 0; this.cache = null;
    var style = global.getComputedStyle(document.documentElement);
    this.colors = {};
    ['bg', 'panel', 'line', 'fg', 'dim', 'accent', 'warn'].forEach(function (key) {
      this.colors[key] = style.getPropertyValue('--' + key).trim();
    }, this);
    global.addEventListener('blur', this.clearInput.bind(this));
  }
  NetView.prototype.clearInput = function () { this.playing = false; };
  NetView.prototype.seek = function (t) {
    N.progress(t); this.t = t; this.playing = false; this.stageInspected = t >= 0.5;
  };
  NetView.prototype.selectCell = function (index) {
    N.point(index, [0, 0, 0, 0], this.t);
    this.selected = index;
    if (![this.seams[this.seam].a.cell, this.seams[this.seam].b.cell].includes(index)) {
      this.seam = this.seams.findIndex(function (s) { return s.a.cell === index || s.b.cell === index; });
    }
  };
  NetView.prototype.step = function (dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('无效播放时间');
    if (!this.playing) return;
    var next = Math.min(1, this.t + dt / 12);
    if (!this.stageInspected && this.t < 0.5 && next >= 0.5) {
      next = 0.5; this.stageInspected = true; this.playing = false;
    }
    this.t = next;
    if (next === 1) this.playing = false;
  };
  NetView.prototype.snapshot = function () {
    if (!this.cache || this.cache.t !== this.t) {
      var ps = N.geometry(this.t), gaps = this.seams.map(function (s) { return N.seamGaps(s, ps); });
      this.cache = { t: this.t, ps: ps, gaps: gaps, drift: N.measure(ps),
        joined: gaps.filter(function (g) { return Math.max.apply(Math, g) <= N.tolerance; }).length };
    }
    var points = N.markers.map(function (m) { return N.point(this.selected, m.p, this.t); }, this);
    return { geometry: this.cache, angles: N.progress(this.t), points: points,
      distance: M4.len(M4.sub(points[0], points[1])) };
  };
  NetView.prototype.project4 = function (p) {
    // A03 全程 0≤w≤4，分母至少为 4；固定视距，不用随进度缩放掩盖材料变化。
    var k = this.mode === 'ortho' ? 1 : 7 / (8 - p[3]);
    return [p[0] * k, p[1] * k, p[2] * k];
  };
  function camera(p, yaw, pitch) {
    var x = p[0] * Math.cos(yaw) - p[2] * Math.sin(yaw);
    var z = p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
    return [x, p[1] * Math.cos(pitch) - z * Math.sin(pitch), p[1] * Math.sin(pitch) + z * Math.cos(pitch)];
  }
  function path(ctx, ps) {
    ctx.beginPath(); ps.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
  }
  NetView.prototype.card = function (r, title, subtitle) {
    var ctx = this.ctx, c = this.colors;
    ctx.fillStyle = c.panel; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = c.fg; ctx.font = 'bold 14px system-ui'; ctx.fillText(title, r.x + 12, r.y + 23, r.w - 24);
    ctx.fillStyle = c.dim; ctx.font = '12px system-ui'; ctx.fillText(subtitle, r.x + 12, r.y + 44, r.w - 24);
  };
  NetView.prototype.scene = function (r, s) {
    var ctx = this.ctx, self = this, c = this.colors;
    var scale = Math.min((r.w - 32) / 10, (r.h - 85) / 9);
    function project(p) {
      var q = self.project4(p); q[1] -= 0.8;
      q = camera(q, self.camYaw, self.camPitch);
      return [r.x + r.w / 2 + q[0] * scale, r.y + r.h / 2 + 18 - q[1] * scale, q[2]];
    }
    var ps = s.geometry.ps.map(function (vs) { return vs.map(project); });
    ctx.save(); ctx.beginPath(); ctx.rect(r.x + 1, r.y + 52, r.w - 2, r.h - 78); ctx.clip();
    N.faces.forEach(function (face) {
      path(ctx, face.map(function (i) { return ps[self.selected][i]; })); ctx.closePath();
      ctx.fillStyle = colors[self.selected]; ctx.globalAlpha = 0.065; ctx.fill();
    });
    var lines = [];
    ps.forEach(function (vs, cell) { N.edges.forEach(function (edge) {
      var points = edge.map(function (i) { return vs[i]; });
      lines.push({ cell: cell, points: points, depth: points[0][2] + points[1][2] });
    }); });
    lines.sort(function (a, b) { return b.depth - a.depth; });
    lines.forEach(function (line) {
      path(ctx, line.points); ctx.strokeStyle = colors[line.cell];
      ctx.globalAlpha = line.cell === self.selected ? 1 : 0.28;
      ctx.lineWidth = line.cell === self.selected ? 2.5 : 1; ctx.stroke();
    });
    ctx.globalAlpha = 1;
    var seam = this.seams[this.seam];
    [seam.a, seam.b].forEach(function (side, i) {
      path(ctx, N.faces[side.face].map(function (v) { return ps[side.cell][v]; })); ctx.closePath();
      ctx.strokeStyle = i ? c.warn : c.fg; ctx.lineWidth = 2; ctx.setLineDash(i ? [5, 4] : []); ctx.stroke();
    });
    ctx.setLineDash([]);
    N.cells.forEach(function (cell, i) {
      var center = project(N.point(i, [0, 0, 0, 0], self.t));
      // 对胞中心的 xyz 会重合；仅文字加引线，绝不移动材料几何来假装分离。
      var dx = i === 0 ? -30 : i === 7 ? 30 : 0, dy = i === 0 ? 24 : i === 7 ? -24 : 0;
      var label = [center[0] + dx, center[1] + dy];
      ctx.strokeStyle = colors[i]; ctx.lineWidth = 1; path(ctx, [center, label]); ctx.stroke();
      ctx.fillStyle = c.panel; ctx.fillRect(label[0] - 18, label[1] - 12, 36, 23);
      ctx.fillStyle = colors[i]; ctx.font = (i === self.selected ? 'bold ' : '') + '14px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.fillText((i + 1) + cell.id, label[0], label[1] + 5);
    });
    ctx.textAlign = 'left';
    s.points.forEach(function (p, i) { self.marker(project(p), i); });
    ctx.restore();
    ctx.fillStyle = c.dim; ctx.font = '12px system-ui';
    ctx.fillText(this.mode === 'ortho' ? '正交丢 w：A/H 重叠，不等于同一块胞' : '固定 4D 透视：不保尺寸；线框重叠不等于穿透',
      r.x + 12, r.y + r.h - 10, r.w - 24);
  };
  NetView.prototype.marker = function (p, i) {
    var ctx = this.ctx;
    ctx.fillStyle = i ? this.colors.accent : this.colors.warn;
    ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 2 * Math.PI); ctx.fill();
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillText(N.markers[i].id, p[0] + 7, p[1] + (i ? 13 : -7));
  };
  NetView.prototype.local = function (r) {
    var ctx = this.ctx, self = this, scale = Math.min((r.w - 45) / 3.4, (r.h - 108) / 3.1);
    function project(p) {
      var q = camera(p, 0.6, -0.35);
      return [r.x + r.w / 2 + q[0] * scale, r.y + r.h / 2 + 8 - q[1] * scale];
    }
    var ps = N.corners.map(project);
    ctx.strokeStyle = colors[this.selected]; ctx.lineWidth = 1.5;
    N.edges.forEach(function (e) { path(ctx, e.map(function (i) { return ps[i]; })); ctx.stroke(); });
    ctx.strokeStyle = this.colors.fg; ctx.setLineDash([3, 3]);
    path(ctx, N.markers.map(function (m) { return project(m.p); })); ctx.stroke(); ctx.setLineDash([]);
    N.markers.forEach(function (m, i) { self.marker(project(m.p), i); });
    ctx.fillStyle = this.colors.dim; ctx.font = '12px system-ui';
    ctx.fillText('P/Q 在三维内部；不是贴在六张皮上', r.x + 12, r.y + r.h - 12, r.w - 24);
  };
  NetView.prototype.seamLabel = function (seam) {
    return N.cells[seam.a.cell].id + ':' + N.faceNames[seam.a.face] + ' ↔ ' +
      N.cells[seam.b.cell].id + ':' + N.faceNames[seam.b.face];
  };
  NetView.prototype.seamRuler = function (r, s) {
    var ctx = this.ctx, c = this.colors, gaps = s.geometry.gaps[this.seam], seam = this.seams[this.seam];
    gaps.forEach(function (gap, i) {
      var y = r.y + 75 + i * 32, left = r.x + 65, width = r.w - 90;
      ctx.fillStyle = c.dim; ctx.font = '12px ui-monospace, monospace'; ctx.fillText('角 ' + (i + 1), r.x + 12, y + 4);
      ctx.strokeStyle = c.line; ctx.lineWidth = 1; path(ctx, [[left, y], [left + width, y]]); ctx.stroke();
      ctx.strokeStyle = c.warn; ctx.lineWidth = 3; path(ctx, [[left, y], [left + width * gap / 10, y]]); ctx.stroke();
      ctx.fillStyle = c.fg; ctx.fillText(gap.toExponential(2), left + 4, y - 7);
    });
    ctx.fillStyle = c.dim; ctx.font = '12px system-ui';
    ctx.fillText(seam.retained ? '保留铰链：两份材料面始终重合' : '待接合面：四对固定材料角点，一一对应',
      r.x + 12, r.y + r.h - 30, r.w - 24);
    ctx.fillText('尺固定 0–10；四维残差，不是屏幕距离', r.x + 12, r.y + r.h - 12, r.w - 24);
  };
  NetView.prototype.draw = function () {
    var cv = this.canvas, ctx = this.ctx, box = cv.getBoundingClientRect(), W = box.width, H = box.height;
    ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    ctx.fillStyle = this.colors.bg; ctx.fillRect(0, 0, W, H);
    // 窄屏四维读数会换行；保留证据区，不能让文字盖住折叠图。
    var stacked = W < 680, top = stacked ? 222 : 174, lower = 268, gap = 12;
    var mainHeight = H - top - (stacked ? 2 * lower + 3 * gap : lower + 2 * gap);
    var main = { x: 12, y: top, w: W - 24, h: mainHeight };
    var local = { x: 12, y: top + mainHeight + gap, w: stacked ? W - 24 : (W - 36) / 2, h: lower };
    var seam = { x: stacked ? 12 : local.x + local.w + gap,
      y: stacked ? local.y + lower + gap : local.y, w: local.w, h: lower };
    this.rects = [main, local, seam];
    var s = this.snapshot();
    this.card(main, '八胞 · 绕二维正方形铰链折起', '白实线 / 黄虚线：当前检查的一对面');
    this.scene(main, s);
    this.card(local, (this.selected + 1) + ' ' + N.cells[this.selected].id + ' 胞 · 固定本地尺', '边长 2；三维体积 8；与相机和进度无关');
    this.local(local);
    this.card(seam, this.seamLabel(this.seams[this.seam]), '本地面编号；逐角核对四维残差');
    this.seamRuler(seam, s);
    if (this.onUpdate) this.onUpdate(s);
  };
  global.NetView = NetView;
})(window);

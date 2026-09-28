/* xyz 图主动暴露重影；同号材料点的 xw 图补回被丢掉的方向，而不是偷偷错开图形。 */
(function (global) {
  'use strict';
  var R = Rings4;
  function RingsView(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('浏览器未能创建 Canvas 2D');
    this.t = 0; this.omitTranslation = false; this.playing = false;
    this.request3 = 0; this.camera = 'oblique'; this.inspected = false;
    this.cache = null;
    var style = global.getComputedStyle(document.documentElement);
    this.colors = {};
    ['bg', 'panel', 'line', 'fg', 'dim', 'accent', 'warn'].forEach(function (key) {
      this.colors[key] = style.getPropertyValue('--' + key).trim();
    }, this);
    this._bindPointer();
  }
  RingsView.prototype.seek = function (t) {
    R.path(t, this.omitTranslation);
    this.t = t; this.playing = false; this.inspected = t >= R.crossingTime;
  };
  RingsView.prototype.setMode = function (omit) {
    this.omitTranslation = omit; this.seek(0);
  };
  RingsView.prototype._bindPointer = function () {
    var self = this, cv = this.canvas, pane = -1;
    function scrub(e) {
      var rect = self.rects[pane], box = cv.getBoundingClientRect();
      var t = 3 * Math.max(0, Math.min(1, (e.clientX - box.left - rect.x) / rect.w));
      if (pane === 0) self.request3 = t;
      else self.seek(t);
    }
    cv.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !self.rects) return;
      var box = cv.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
      for (var i = 0; i < 2; i++) {
        var r = self.rects[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          pane = i; cv.setPointerCapture(e.pointerId); scrub(e); break;
        }
      }
    });
    cv.addEventListener('pointermove', function (e) { if (pane >= 0) scrub(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (event) {
      cv.addEventListener(event, function () { pane = -1; });
    });
    this.clearInput = function () { pane = -1; self.playing = false; };
    global.addEventListener('blur', this.clearInput);
  };
  RingsView.prototype.step = function (dt) {
    if (!this.playing) return;
    var next = Math.min(3, this.t + dt / 3);
    if (!this.omitTranslation && !this.inspected && this.t < R.crossingTime && next >= R.crossingTime) {
      next = R.crossingTime; this.inspected = true; this.playing = false;
    }
    this.t = next;
    if (next === 3) this.playing = false;
  };
  RingsView.prototype.snapshot = function () {
    var p = R.path(this.t, this.omitTranslation), p3 = R.pull3(this.request3);
    if (!this.cache || this.cache.x !== p.x || this.cache.w !== p.w) {
      var ps = R.rings(p);
      this.cache = { x: p.x, w: p.w, rings: ps, capsules: R.capsuleDistance(ps) };
    }
    return { pose: p, pose3: p3, rings: this.cache.rings, rings3: R.rings(p3),
      closest: R.minimum(p), closest3: R.minimum(p3), capsules: this.cache.capsules };
  };
  function line(ctx, a, b) {
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  RingsView.prototype.card = function (r, title, subtitle) {
    var ctx = this.ctx, c = this.colors;
    ctx.fillStyle = c.panel; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = c.fg; ctx.font = 'bold 14px system-ui'; ctx.fillText(title, r.x + 12, r.y + 23, r.w - 24);
    ctx.fillStyle = c.dim; ctx.font = '12px system-ui'; ctx.fillText(subtitle, r.x + 12, r.y + 44, r.w - 24);
  };
  RingsView.prototype.projector = function (r) {
    var yaw = this.camera === 'front' ? 0 : 0.55, pitch = this.camera === 'front' ? 0 : -0.4;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var scale = Math.min((r.w - 30) / 6.6, (r.h - 95) / 3.3);
    function project(p) {
      var x = (p[0] - 2) * cy - p[2] * sy, z = (p[0] - 2) * sy + p[2] * cy;
      return [r.x + r.w / 2 + x * scale, r.y + r.h / 2 + 14 - (p[1] * cp - z * sp) * scale,
        p[1] * sp + z * cp];
    }
    project.scale = scale;
    return project;
  };
  RingsView.prototype.scene = function (r, ps, closest, disk, contact) {
    var ctx = this.ctx, c = this.colors, project = this.projector(r), segments = [];
    ctx.save(); ctx.beginPath(); ctx.rect(r.x + 1, r.y + 52, r.w - 2, r.h - 76); ctx.clip();
    if (disk) {
      ctx.beginPath();
      ps.a.forEach(function (p, i) { var q = project(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath(); ctx.fillStyle = c.accent; ctx.globalAlpha = 0.1; ctx.fill(); ctx.globalAlpha = 1;
    }
    [ps.a, ps.b].forEach(function (ring, n) {
      var projected = ring.map(project);
      R.edges.forEach(function (e) {
        var a = projected[e[0]], b = projected[e[1]];
        segments.push({ a: a, b: b, depth: (a[2] + b[2]) / 2, color: n ? c.warn : c.accent });
      });
    });
    segments.sort(function (a, b) { return b.depth - a.depth; });
    ctx.lineCap = 'round';
    segments.forEach(function (s) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2 * R.rho * project.scale; line(ctx, s.a, s.b);
    });
    var pa = project(closest.a), pb = project(closest.b);
    ctx.strokeStyle = c.fg; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); line(ctx, pa, pb); ctx.setLineDash([]);
    [pa, pb].forEach(function (q, i) {
      ctx.fillStyle = i ? c.warn : c.accent; ctx.strokeStyle = c.fg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(q[0], q[1], i ? 7 : 4, 0, 2 * Math.PI); ctx.stroke();
      ctx.font = 'bold 12px ui-monospace, monospace';
      var dx = i ? 10 : -38, dy = i ? 21 : -13;
      ctx.lineWidth = 3; ctx.strokeStyle = c.bg; ctx.strokeText(i ? 'B(π)' : 'A(0)', q[0] + dx, q[1] + dy);
      ctx.fillText(i ? 'B(π)' : 'A(0)', q[0] + dx, q[1] + dy);
    });
    if (contact) {
      var q = project(M4.scale(M4.add(closest.a, closest.b), 0.5));
      ctx.strokeStyle = c.warn; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q[0], q[1], 12, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = c.dim; ctx.font = '11px system-ui';
    ctx.fillText(disk ? '淡蓝圆盘仅是拓扑辅助面，不是实体障碍' : '正交丢 w；描边是管的投影，不是三维实体', r.x + 12, r.y + r.h - 10);
  };
  RingsView.prototype.witness = function (r, s) {
    var ctx = this.ctx, c = this.colors, q = s.closest;
    this.card(r, '同一对最近材料点 · xw 尺', 'A(0)、B(π) 固定身份；x、w 等比例');
    var scale = Math.min((r.w - 65) / 3.6, (r.h - 140) / 1.4), ox = r.x + 35, oy = r.y + r.h - 84;
    function project(p) { return [ox + p[0] * scale, oy - p[3] * scale]; }
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    [0, 1].forEach(function (w) {
      line(ctx, [ox, oy - w * scale], [r.x + r.w - 15, oy - w * scale]);
      ctx.fillStyle = c.dim; ctx.font = '11px ui-monospace, monospace'; ctx.fillText('w=' + w, ox, oy - w * scale - 8);
    });
    [0, 1, 2, 3].forEach(function (x) { ctx.fillText('x=' + x, ox + x * scale - 8, oy + 20); });
    var pa = project(q.a), pb = project(q.b);
    ctx.strokeStyle = c.fg; ctx.lineWidth = 2; line(ctx, pa, pb);
    [pa, pb].forEach(function (p, i) {
      ctx.fillStyle = i ? c.warn : c.accent; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 2 * Math.PI); ctx.fill();
      ctx.font = 'bold 12px ui-monospace, monospace'; ctx.fillText(i ? 'B(π)' : 'A(0)', p[0] + 9, p[1] + 4);
    });
    ctx.fillStyle = c.fg; ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('wA=0.000  wB=' + q.b[3].toFixed(3) + '  Δw=' + q.b[3].toFixed(3), r.x + 12, r.y + r.h - 40);
    ctx.fillText('dxyz=' + q.projected.toFixed(6) + '  d4=' + q.distance.toFixed(6), r.x + 12, r.y + r.h - 20);
  };
  RingsView.prototype.chart = function (r) {
    var ctx = this.ctx, c = this.colors, self = this;
    this.card(r, '整条连续路径 · 距离证书', '实线 d₄；虚线解析下界；底线管径 0.2');
    var left = r.x + 30, top = r.y + 65, w = r.w - 50, h = r.h - 112;
    function project(t, d) { return [left + t / 3 * w, top + h * (1 - d / 2.6)]; }
    ctx.strokeStyle = c.warn; ctx.lineWidth = 1; line(ctx, project(0, 0.2), project(3, 0.2));
    ctx.fillStyle = c.dim; ctx.font = '11px ui-monospace, monospace';
    [0.2, 1, 2].forEach(function (d) { ctx.fillText(String(d), r.x + 5, project(0, d)[1] + 4); });
    [1, 2].forEach(function (t) { ctx.strokeStyle = c.line; line(ctx, project(t, 0), project(t, 2.6)); });
    [false, true].forEach(function (bound) {
      ctx.strokeStyle = bound ? c.fg : c.accent; ctx.lineWidth = bound ? 1 : 2; ctx.setLineDash(bound ? [5, 4] : []);
      ctx.beginPath();
      for (var i = 0; i <= 300; i++) {
        var t = i / 100, p = R.path(t, self.omitTranslation);
        var q = project(t, bound ? p.bound : R.minimum(p).distance);
        if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
      }
      ctx.stroke();
    });
    ctx.setLineDash([]); ctx.strokeStyle = c.fg; line(ctx, project(this.t, 0), project(this.t, 2.6));
    ctx.fillStyle = c.dim; ctx.font = '11px system-ui';
    ['① 升 w', this.omitTranslation ? '② 不平移' : '② 移 x', '③ 降 w'].forEach(function (title, i) {
      ctx.fillText(title, left + (i + 0.12) * w / 3, top + h + 18);
    });
    ctx.fillText('全程保证：d₄ − 2ρ ≥ 0.8，不依赖帧率', r.x + 12, r.y + r.h - 10);
  };
  RingsView.prototype.draw = function () {
    var ctx = this.ctx, cv = this.canvas, box = cv.getBoundingClientRect(), W = box.width, H = box.height;
    ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    ctx.fillStyle = this.colors.bg; ctx.fillRect(0, 0, W, H);
    // 窄屏的证据数字会换行；预留高度避免把安全下界盖在圆环图上。
    var stacked = W < 700, top = stacked ? 204 : 156, gap = 12, width = stacked ? W - 24 : (W - 36) / 2;
    var height = (H - top - (stacked ? 48 : 24)) / (stacked ? 4 : 2);
    var rects = [0, 1, 2, 3].map(function (i) {
      return { x: 12 + (stacked ? 0 : i % 2 * (width + gap)),
        y: top + (stacked ? i : Math.floor(i / 2)) * (height + gap), w: width, h: height };
    });
    this.rects = rects;
    var s = this.snapshot();
    this.card(rects[0], '三维：横拖尝试沿 x 拉开', s.pose3.contact ? '首次管面接触 · x=0.800，不能越过' : 'w=0 锁定 · 初始链环数 −1');
    this.scene(rects[0], s.rings3, s.closest3, true, s.pose3.contact);
    var title = this.omitTranslation ? '失败路径：升起，再原路落回' : '四维：升 w → 移 x → 降 w';
    this.card(rects[1], title, '第 ' + s.pose.stage + ' 段 · x=' + s.pose.x.toFixed(3) + '  w=' + s.pose.w.toFixed(3));
    this.scene(rects[1], s.rings, s.closest, false, false);
    this.witness(rects[2], s); this.chart(rects[3]);
    if (this.onUpdate) this.onUpdate(s);
  };
  global.RingsView = RingsView;
})(window);

/* 两个固定投影共同解释丢失的方向；补图不跟着物体偷偷换基。 */
(function (global) {
  'use strict';
  var C = Chirality4;

  function ChiralityView(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('浏览器未能创建 Canvas 2D');
    this.angles = { xy: 0, xz: 0, yz: 0 };
    this.theta = 0;
    this.playing = false;
    this.camera = 'oblique';
    this.selected = 0;
    this.showTarget = true;
    this.initialVolume = C.materialVolume(C.witness(C.points));
    var style = global.getComputedStyle(document.documentElement);
    this.colors = {};
    ['bg', 'panel', 'line', 'fg', 'dim', 'accent', 'warn'].forEach(function (key) {
      this.colors[key] = style.getPropertyValue('--' + key).trim();
    }, this);
    this._bindPointer();
  }
  ChiralityView.prototype._bindPointer = function () {
    var self = this, cv = this.canvas, drag = null;
    function location(e) {
      var r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function scrub(x) {
      var r = self.rects[1];
      self.theta = Math.PI * Math.max(0, Math.min(1, (x - r.x) / r.w));
      self.playing = false;
    }
    cv.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !self.rects) return;
      var p = location(e);
      for (var i = 0; i < 2; i++) {
        var r = self.rects[i];
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
          drag = { pane: i, x: p.x, y: p.y };
          cv.setPointerCapture(e.pointerId);
          if (i === 1) scrub(p.x);
          break;
        }
      }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = location(e);
      if (drag.pane === 1) scrub(p.x);
      else {
        var xz = self.angles.xz + (p.x - drag.x) * 0.01;
        var yz = self.angles.yz + (p.y - drag.y) * 0.01;
        self.angles.xz = Math.atan2(Math.sin(xz), Math.cos(xz));
        self.angles.yz = Math.atan2(Math.sin(yz), Math.cos(yz));
      }
      drag.x = p.x; drag.y = p.y;
    });
    this.clearInput = function () { drag = null; self.playing = false; };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (event) {
      cv.addEventListener(event, function () { drag = null; });
    });
    global.addEventListener('blur', this.clearInput);
  };
  ChiralityView.prototype.step = function (dt) {
    if (!this.playing) return;
    this.theta = Math.min(Math.PI, this.theta + dt * Math.PI / 8);
    if (this.theta === Math.PI) this.playing = false;
  };
  ChiralityView.prototype.snapshot = function () {
    var r3 = C.rotation3(this.angles.xy, this.angles.xz, this.angles.yz), r4 = C.rotation4(this.theta);
    var p3 = C.transform(C.points, r3), p4 = C.transform(C.points, r4), tetra = C.witness(p4);
    return {
      r3: r3, r4: r4, p3: p3, p4: p4, e3: C.mismatch(p3), e4: C.mismatch(p4),
      errors3: C.errors(p3), errors4: C.errors(p4),
      det: C.det4(r4), volume: C.materialVolume(tetra), projectedVolume: C.signedVolume(tetra),
      distance: M4.len(M4.sub(p4[9], p4[8]))
    };
  };
  ChiralityView.prototype.projector = function (rect, yzw) {
    var yaw = this.camera === 'front' ? 0 : this.camera === 'back' ? Math.PI : 0.42;
    var pitch = this.camera === 'oblique' ? -0.22 : 0;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var scale = Math.min((rect.w - 48) / 3.8, (rect.h - 88) / 3.8);
    return function (p) {
      var horizontal = yzw ? p[3] : p[0];
      var x = horizontal * cy - p[2] * sy, z = horizontal * sy + p[2] * cy;
      var y = p[1] * cp - z * sp, depth = p[1] * sp + z * cp;
      // 两级都用正交投影，固定同一尺度，避免透视大小变化冒充匹配进度。
      return [rect.x + rect.w / 2 + x * scale, rect.y + rect.h / 2 + 18 - y * scale, depth];
    };
  };
  ChiralityView.prototype.card = function (rect, title, subtitle) {
    var ctx = this.ctx, colors = this.colors;
    ctx.fillStyle = colors.panel; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = colors.line; ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = colors.fg; ctx.font = 'bold 14px system-ui';
    ctx.fillText(title, rect.x + 12, rect.y + 23);
    ctx.fillStyle = colors.dim; ctx.font = '12px system-ui';
    ctx.fillText(subtitle, rect.x + 12, rect.y + 44);
  };
  function line(ctx, a, b) {
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ChiralityView.prototype.hand = function (rect, R, points, yzw, overlay) {
    var ctx = this.ctx, project = this.projector(rect, yzw), self = this;
    var vs = C.transform(C.vertices, R).map(project);
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x + 1, rect.y + 52, rect.w - 2, rect.h - 75); ctx.clip();
    var faces = C.faces.map(function (f) {
      var ps = f.ids.map(function (i) { return vs[i]; });
      return { ps: ps, color: f.color, depth: ps.reduce(function (sum, p) { return sum + p[2]; }, 0) / 4 };
    }).sort(function (a, b) { return b.depth - a.depth; });
    faces.forEach(function (f) {
      ctx.beginPath();
      f.ps.forEach(function (p, i) { if (!i) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath(); ctx.fillStyle = f.color; ctx.fill();
      ctx.strokeStyle = '#302c32'; ctx.lineWidth = 0.6; ctx.stroke();
    });
    if (overlay && this.showTarget) {
      var target = C.targetVertices.map(project);
      ctx.strokeStyle = this.colors.accent; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      C.edges.forEach(function (e) { line(ctx, target[e[0]], target[e[1]]); });
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // 标号穿透遮挡显示，避免背面的材料点消失后被误认为身份互换。
    points.forEach(function (p, i) {
      var a = project(p), b = project(C.target[i]), selected = self.selected === i;
      ctx.strokeStyle = C.markers[i].color; ctx.fillStyle = C.markers[i].color;
      if (overlay && self.showTarget) {
        ctx.globalAlpha = selected ? 1 : 0.4;
        line(ctx, a, b);
        ctx.beginPath(); ctx.arc(b[0], b[1], selected ? 7 : 4, 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(a[0], a[1], selected ? 5 : 3, 0, 2 * Math.PI); ctx.fill();
      ctx.font = (selected ? 'bold 13px' : '11px') + ' ui-monospace, monospace';
      var dx = i === 0 || i === 8 ? -17 : 7, dy = i === 1 ? 15 : -7;
      ctx.lineWidth = 3; ctx.strokeStyle = this.colors.bg;
      ctx.strokeText(C.markers[i].id, a[0] + dx, a[1] + dy);
      ctx.fillText(C.markers[i].id, a[0] + dx, a[1] + dy);
    }, this);
    ctx.restore();
  };
  ChiralityView.prototype.trace = function (rect, ps) {
    var ctx = this.ctx, scale = Math.min(rect.w - 80, rect.h - 120) / 2.2;
    var ox = rect.x + rect.w / 2, oy = rect.y + (rect.h + 20) / 2;
    function project(p) { return [ox + p[0] * scale, oy - p[3] * scale]; }
    this.card(rect, 'A / B 的 xw 记录', '圆弧是材料点轨迹，不是缩放动画');
    ctx.strokeStyle = this.colors.dim; ctx.lineWidth = 1;
    line(ctx, [rect.x + 20, oy], [rect.x + rect.w - 20, oy]);
    line(ctx, [ox, rect.y + 58], [ox, rect.y + rect.h - 42]);
    ctx.fillStyle = this.colors.dim;
    ctx.fillText('x', rect.x + rect.w - 22, oy - 8); ctx.fillText('w', ox + 8, rect.y + 68);
    [8, 9].forEach(function (i) {
      ctx.strokeStyle = C.markers[i].color; ctx.fillStyle = C.markers[i].color;
      ctx.setLineDash([3, 4]); ctx.beginPath();
      for (var j = 0; j <= 120; j++) {
        var q = project(M4.mulVec(C.rotation4(Math.PI * j / 120), C.points[i]));
        if (!j) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke(); ctx.setLineDash([]);
      var p = project(ps[i]); ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(C.markers[i].id, p[0] + 8, p[1] - 8);
    });
    ctx.strokeStyle = this.colors.fg; line(ctx, project(ps[8]), project(ps[9]));
    var d = M4.sub(ps[9], ps[8]);
    ctx.fillStyle = this.colors.fg; ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('Δx=' + d[0].toFixed(3) + '  Δw=' + d[3].toFixed(3), rect.x + 12, rect.y + rect.h - 26);
    ctx.fillStyle = this.colors.dim;
    ctx.fillText('90°：x 重合，w 仍相距 1.200', rect.x + 12, rect.y + rect.h - 9);
  };
  ChiralityView.prototype.draw = function () {
    var ctx = this.ctx, cv = this.canvas, bounds = cv.getBoundingClientRect();
    var W = bounds.width, H = bounds.height, gap = 12, top = 116, stacked = W < 680;
    ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    ctx.fillStyle = this.colors.bg; ctx.fillRect(0, 0, W, H);
    var w = stacked ? W - 24 : (W - 36) / 2;
    var usable = H - top - 12, h = stacked ? (usable - gap * 3) / 4 : (usable - gap) * 0.55;
    var rects = stacked
      ? [0, 1, 2, 3].map(function (i) { return { x: 12, y: top + i * (h + gap), w: w, h: h }; })
      : [{ x: 12, y: top, w: w, h: h }, { x: w + 24, y: top, w: w, h: h },
        { x: 12, y: top + h + gap, w: w, h: usable - h - gap },
        { x: w + 24, y: top + h + gap, w: w, h: usable - h - gap }];
    this.rects = rects;
    var s = this.snapshot();
    this.card(rects[0], '三维：拖动旋转，尝试叠合', '失配 ' + (100 * s.e3).toFixed(6) + '% · 下界 ' + (100 * C.lowerBound).toFixed(3) + '%');
    this.card(rects[1], '四维：横拖转 xw · xyz 投影', '失配 ' + (s.e4 < 1e-8 ? s.e4.toExponential(2) + '（浮点残差）' : (100 * s.e4).toFixed(6) + '%'));
    this.hand(rects[0], s.r3, s.p3, false, true);
    this.hand(rects[1], s.r4, s.p4, false, true);
    ctx.fillStyle = this.colors.dim; ctx.font = '11px system-ui';
    [rects[0], rects[1]].forEach(function (r) {
      ctx.fillText('实点＝原手；空圈 / 蓝虚线＝固定目标', r.x + 12, r.y + r.h - 10);
    });
    this.trace(rects[2], s.p4);
    this.card(rects[3], '同一时刻 · yzw 补充投影', '固定横轴 w：90° 时完整材料空间在这里');
    this.hand(rects[3], s.r4, s.p4, true, false);
    ctx.fillStyle = this.colors.dim; ctx.font = '11px system-ui';
    ctx.fillText('只换观察轴，不改坐标；端点此图会退化', rects[3].x + 12, rects[3].y + rects[3].h - 10);
    if (this.onUpdate) this.onUpdate(s);
  };

  global.ChiralityView = ChiralityView;
})(window);

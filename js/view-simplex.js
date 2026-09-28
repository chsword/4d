/* 主图故意允许重影；补充法向尺和逐材料点的距离表，避免把影子当作解。 */
(function (global) {
  'use strict';
  var S = Simplex4;
  function SimplexView(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('浏览器未能创建 Canvas 2D');
    this.dimension = 3; this.size = 1; this.rotation = M4.ident();
    this.camYaw = 0.6; this.camPitch = -0.25; this.mode = 'ortho';
    this.challenge = ''; this.assisted = false; this.feedback = '先只用 x/y/z，试着让十条距离都等于基底边长。';
    this.completed = { size: false, rotation: false, low: false };
    this.colors = {};
    var style = global.getComputedStyle(document.documentElement);
    ['bg', 'panel', 'line', 'fg', 'dim', 'accent', 'warn'].forEach(function (key) {
      this.colors[key] = style.getPropertyValue('--' + key).trim();
    }, this);
    this.resetPoint();
  }
  SimplexView.prototype.model = function () { return S.create(this.dimension, this.size, this.rotation); };
  SimplexView.prototype.resetPoint = function () {
    this.unlocked = false; this.p = [0.7 * this.size, -0.4 * this.size, this.dimension === 3 ? 0.3 * this.size : 0, 0];
  };
  SimplexView.prototype.setCoordinate = function (axis, value) {
    if (!Number.isInteger(axis) || axis < 0 || axis > this.dimension || !Number.isFinite(value) ||
        Math.abs(value) > 3.5 * this.size || axis === this.dimension && !this.unlocked) throw new Error('坐标超界或额外方向尚未开放');
    this.p[axis] = value;
  };
  SimplexView.prototype.unlock = function (enabled) {
    this.unlocked = enabled;
    if (!enabled) this.p[this.dimension] = 0;
  };
  SimplexView.prototype.best = function () {
    this.p = S.best(this.model()); this.unlock(false);
    this.feedback = '这是全局最小最大误差，不是等距解；一条偏长，其余偏短。';
  };
  SimplexView.prototype.center = function () {
    this.p = [0, 0, 0, 0];
    this.feedback = '质心到基点等距，但都短于边长；“到基点等距”不等于“全部点对等长”。';
  };
  SimplexView.prototype.reveal = function (sign) {
    this.unlock(true); this.p = S.exact(this.model(), sign); this.assisted = true;
    this.feedback = '解析解已揭示；本题只算演示，不计迁移通过。请重新出题后自行放置。';
  };
  SimplexView.prototype.startChallenge = function (kind) {
    if (['size', 'rotation', 'low'].indexOf(kind) < 0) throw new Error('未知迁移题');
    this.challenge = kind; this.assisted = false; this.completed[kind] = false;
    this.dimension = kind === 'low' ? 2 : 3;
    if (kind === 'size') this.size = this.size < 1.1 ? 1.45 : 0.75;
    if (kind === 'low') this.size = this.size === 1.15 ? 0.85 : 1.15;
    this.turns = (this.turns || 0) + 1;
    this.rotation = kind === 'rotation'
      ? M4.mul(M4.rotation('yz', 0.73 * this.turns), M4.mul(M4.rotation('xz', -0.91), M4.rotation('xy', 0.42)))
      : M4.ident();
    this.resetPoint();
    this.feedback = kind === 'rotation' ? '真正转动材料基底（不是相机）：同尺寸下，精确解的法向高度会变吗？'
      : kind === 'low' ? '重做低维题：先在 xy 平面试，再开放 z；这次 w 始终为 0。'
        : '尺寸已改变，旧的 √5 不能照抄。预测法向高度规则，再自行放置。';
  };
  SimplexView.prototype.checkTransfer = function (prediction) {
    if (!this.challenge) { this.feedback = '请先选择一项迁移题。'; return false; }
    var correct = prediction === (this.challenge === 'rotation' ? 'same' : 'pythagoras');
    var ok = correct && S.measure(this.model(), this.p).success && !this.assisted;
    this.completed[this.challenge] = ok;
    this.feedback = this.assisted ? '本题已看答案，不计通过；重新出题即可再试。'
      : !correct ? '预测还不对：额外位移垂直于整个基底，h²=L²−R²；SO(3) 不改变 L 或 R。'
        : !ok ? '预测正确，但位置未达标：还需让每一条真实距离的相对误差 ≤1%。'
          : '迁移通过：预测正确，且自行放置的全部真实距离误差 ≤1%；不是机器精度精确解。';
    return ok;
  };
  SimplexView.prototype.snapshot = function () {
    var model = this.model();
    var evidence = S.measure(model, this.p);
    return { model: model, evidence: evidence, bound: S.bound(model),
      projection: S.recoverProjection(model, this.p) };
  };
  SimplexView.prototype.project = function (p, rect) {
    var k = this.mode === 'perspective' ? 12 / (12 - p[3]) : 1;
    var x = p[0] * k, y = p[1] * k, z = p[2] * k;
    var x1 = x * Math.cos(this.camYaw) - z * Math.sin(this.camYaw);
    var z1 = x * Math.sin(this.camYaw) + z * Math.cos(this.camYaw);
    var y1 = y * Math.cos(this.camPitch) - z1 * Math.sin(this.camPitch);
    var z2 = y * Math.sin(this.camPitch) + z1 * Math.cos(this.camPitch);
    var perspective = 16 / (16 + z2), scale = Math.min(rect.w / 9, (rect.h - 85) / 8);
    return [rect.x + rect.w / 2 + x1 * perspective * scale,
      rect.y + rect.h / 2 + 12 - y1 * perspective * scale, z2];
  };
  function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  SimplexView.prototype.card = function (r, title, subtitle) {
    var ctx = this.ctx, c = this.colors;
    ctx.fillStyle = c.panel; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = c.fg; ctx.font = 'bold 14px system-ui'; ctx.fillText(title, r.x + 12, r.y + 23, r.w - 24);
    ctx.fillStyle = c.dim; ctx.font = '12px system-ui'; ctx.fillText(subtitle, r.x + 12, r.y + 44, r.w - 24);
  };
  SimplexView.prototype.scene = function (r, s) {
    var ctx = this.ctx, c = this.colors, self = this, n = this.dimension + 1;
    var ps = s.evidence.points.map(function (p) { return self.project(p, r); });
    ctx.save(); ctx.beginPath(); ctx.rect(r.x + 1, r.y + 53, r.w - 2, r.h - 80); ctx.clip();
    s.evidence.rows.slice().sort(function (a, b) {
      return ps[b.a][2] + ps[b.b][2] - ps[a.a][2] - ps[a.b][2];
    }).forEach(function (row) {
      ctx.strokeStyle = row.b === n ? c.warn : c.accent;
      ctx.lineWidth = row.b === n ? 2 : 1.5;
      ctx.setLineDash(row.b === n ? [5, 3] : []); line(ctx, ps[row.a], ps[row.b]);
    });
    ctx.setLineDash([]);
    ps.forEach(function (p, i) {
      ctx.fillStyle = i === n ? c.warn : c.accent;
      ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 2 * Math.PI); ctx.fill();
      ctx.font = 'bold 13px ui-monospace, monospace'; ctx.fillText(i === n ? 'P' : 'ABCD'[i], p[0] + 7, p[1] - 7);
    });
    ctx.restore();
    ctx.fillStyle = c.dim; ctx.font = '12px system-ui';
    ctx.fillText('实线基底 / 虚线新增；影子不保长', r.x + 12, r.y + r.h - 12, r.w - 24);
  };
  SimplexView.prototype.ruler = function (r) {
    var ctx = this.ctx, c = this.colors, x = r.x + r.w / 2, mid = r.y + (r.h + 36) / 2;
    var scale = (r.h - 100) / 12, h = this.p[this.dimension], y = mid - h * scale;
    ctx.lineWidth = 2; ctx.strokeStyle = c.accent;
    line(ctx, [x, mid - 6 * scale], [x, mid + 6 * scale]);
    for (var i = -6; i <= 6; i += 2) {
      line(ctx, [x - 4, mid - i * scale], [x + 4, mid - i * scale]);
      ctx.fillStyle = c.dim; ctx.font = '12px ui-monospace, monospace'; ctx.fillText(String(i), x - 25, mid - i * scale + 4);
    }
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(x, mid, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = c.warn; ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.fillText('P ' + h.toFixed(4), x + 10, y - 8, r.w / 2 - 20);
    ctx.fillStyle = c.dim; ctx.font = '12px system-ui';
    ctx.fillText('基底全在 0；这里只看法向分量', r.x + 12, r.y + r.h - 12, r.w - 24);
  };
  SimplexView.prototype.draw = function () {
    var cv = this.canvas, ctx = this.ctx, box = cv.getBoundingClientRect(), W = box.width, H = box.height;
    ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    ctx.fillStyle = this.colors.bg; ctx.fillRect(0, 0, W, H);
    var narrow = W < 680, top = narrow ? 170 : 140;
    var main = { x: 12, y: top, w: narrow ? W - 24 : (W - 36) * 0.65, h: 360 };
    var ruler = { x: narrow ? 12 : main.x + main.w + 12, y: narrow ? top + 372 : top,
      w: narrow ? W - 24 : W - main.w - 36, h: narrow ? 220 : 360 };
    this.rects = [main, ruler];
    var s = this.snapshot();
    this.card(main, this.dimension === 3 ? '四面体 ABCD + 第五点 P' : '平面三角形 ABC + 第四点 P',
      this.mode === 'ortho' ? '正交丢 w，再用三维相机观察' : '4D 透视，再用三维相机观察');
    this.scene(main, s);
    this.card(ruler, (this.dimension === 3 ? 'w' : 'z') + ' 法向坐标尺',
      this.dimension === 3 ? '不是屏幕上的第四根空间轴' : '离开 xy 平面的方向；w 始终为 0');
    this.ruler(ruler);
    if (this.onUpdate) this.onUpdate(s);
  };
  global.SimplexView = SimplexView;
})(window);

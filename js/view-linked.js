/* A08: one scene, one slice camera, and a separate overview camera. */
(function (global) {
  'use strict';

  function boxMesh(object) {
    if (object.type !== 'box') throw new TypeError('Exact linked sections currently support boxes only');
    var h = ['hx', 'hy', 'hz', 'hw'].map(function (key) { return object.params[key]; });
    var verts = [], edges = [], faces = [];
    for (var mask = 0; mask < 16; mask++) {
      verts.push(h.map(function (size, axis) { return object.center[axis] + (mask & (1 << axis) ? size : -size); }));
      for (var a = 0; a < 4; a++) {
        if (!(mask & (1 << a))) edges.push([mask, mask | (1 << a)]);
        for (var b = a + 1; b < 4; b++) {
          if (!(mask & ((1 << a) | (1 << b)))) {
            faces.push([mask, mask | (1 << a), mask | (1 << a) | (1 << b), mask | (1 << b)]);
          }
        }
      }
    }
    return { verts: verts, edges: edges, faces: faces };
  }

  function section(mesh, camera, normal) {
    var distances = mesh.verts.map(function (p) { return M4.dot(M4.sub(p, camera), normal); });
    return Section4.cut(mesh.verts, mesh.faces.map(function (face) {
      return face.map(function (i, j) { return [i, face[(j + 1) % face.length]]; });
    }), distances);
  }

  function windowMesh(camera, frame) {
    var axes = [M4.col(frame, 0), M4.col(frame, 1), M4.col(frame, 2)];
    var verts = [], edges = [];
    for (var i = 0; i < 8; i++) {
      var p = camera.slice(), q = [i & 1 ? 3 : -3, i & 2 ? 1.6 : -1.6, i & 4 ? 7 : -1];
      axes.forEach(function (axis, j) { p = M4.add(p, M4.scale(axis, q[j])); });
      verts.push(p);
      for (var j = 0; j < 3; j++) if (!(i & (1 << j))) edges.push([i, i | (1 << j)]);
    }
    return { verts: verts, edges: edges };
  }

  function LinkedView(canvas, sliceCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = Scene4.linked;
    this.slice = new SliceView(sliceCanvas, this.scene);
    if (this.slice.error) { this.error = this.slice.error; return; }
    this.objects = this.scene.objects.filter(function (o) { return o.type === 'box'; });
    this.meshes = this.objects.map(boxMesh);
    this.camYaw = 0.6; this.camPitch = -0.45; this.camDist = 6.5;
    ProjectionView.prototype._bindMouse.call(this);
    this.selected = 'wall';
    this.reset();
  }
  LinkedView.prototype.reset = function () {
    this.slice.cam = [0, 0.4, -13, 0];
    this.slice.yaw = 0; this.slice.pitch = 0;
    this.slice.resetW();
    this.slice.keys = {};
    this.slice.wTint = false;
  };
  LinkedView.prototype.snapshot = function () {
    var camera = this.slice.cam.slice(), frame = this.slice.frame(), n = M4.col(frame, 3);
    return {
      camera: camera, frame: frame, normal: n,
      window: windowMesh(camera, frame),
      sections: this.meshes.map(function (mesh) { return section(mesh, camera, n); }),
      hit: this.scene.raycast(camera, M4.col(frame, 2))
    };
  };
  LinkedView.prototype.predict = function (w, exists) {
    this.slice.setW(w);
    var state = this.snapshot(), index = this.objects.findIndex(function (o) { return o.id === this.selected; }, this);
    return { correct: (state.sections[index].verts.length > 0) === exists,
      exists: state.sections[index].verts.length > 0, reached: Math.abs(this.slice.cam[3] - w) < 1e-8 };
  };
  LinkedView.prototype.step = function (dt) { this.slice.step(dt); };
  LinkedView.prototype.draw = function () {
    var state = this.snapshot(), self = this;
    this.objects.forEach(function (o) { if (o.id === self.selected) self.slice.selectedMaterial = o.material; });
    this.slice.draw();
    this.drawOverview(state);
    var hit = state.hit;
    document.getElementById('linked-readout').textContent =
      'w=' + state.camera[3].toFixed(2) + ' · xyz=(' + state.camera.slice(0, 3).map(function (x) { return x.toFixed(1); }).join(', ') +
      ') · 准星：' + (hit ? hit.object.id + '，材料坐标 (' + hit.local.map(function (x) { return x.toFixed(2); }).join(', ') + ')' : '未命中') +
      (this.slice.locked ? '' : ' · ' + (this.slice.pointerError || '点击切片锁定鼠标'));
    var slider = document.getElementById('linked-w');
    if (document.activeElement !== slider) slider.value = state.camera[3];
  };
  LinkedView.prototype.drawOverview = function (state, omitObjects) {
    var ctx = this.ctx, cv = this.canvas, W = cv.width, H = cv.height;
    var dpi = W / (cv.clientWidth || W), S = Math.min(W, H) * 0.36;
    var pivot = this.objects[0].center, R = M4.rotation('xw', 1.05);
    var cy = Math.cos(this.camYaw), sy = Math.sin(this.camYaw);
    var cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch), distance = this.camDist;
    function project(p) {
      var v = M4.scale(M4.mulVec(R, M4.sub(p, pivot)), 1 / 6);
      if (v[3] >= 3.95) return null;
      var q = M4.project4to3(v, 4);
      var x = q[0] * cy - q[2] * sy, z = q[0] * sy + q[2] * cy;
      var y = q[1] * cp - z * sp, depth = q[1] * sp + z * cp + distance;
      if (depth <= 0.15) return null;
      return [W / 2 + x * distance / depth * S, H / 2 - y * distance / depth * S, depth];
    }
    function lines(mesh, color, width, alpha) {
      var points = mesh.verts.map(project);
      ctx.strokeStyle = color; ctx.lineWidth = width * dpi; ctx.globalAlpha = alpha;
      mesh.edges.slice().sort(function (a, b) {
        if (!points[a[0]] || !points[a[1]] || !points[b[0]] || !points[b[1]]) return 0;
        return points[b[0]][2] + points[b[1]][2] - points[a[0]][2] - points[a[1]][2];
      }).forEach(function (edge) {
        var a = points[edge[0]], b = points[edge[1]];
        if (!a || !b) return;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    function point(p, color, label, radius) {
      var q = project(p);
      if (!q) return;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q[0], q[1], radius * dpi, 0, 2 * Math.PI); ctx.fill();
      if (label) ctx.fillText(label, q[0] + 7 * dpi, q[1] - 7 * dpi);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0c14'; ctx.fillRect(0, 0, W, H);
    ctx.font = 11 * dpi + 'px ui-monospace, monospace';
    var colors = ['#8c92a6', '#ffd633'];
    if (!omitObjects) this.meshes.forEach(function (mesh, i) { lines(mesh, colors[i], 1, 0.32); });
    ctx.setLineDash([5 * dpi, 4 * dpi]);
    lines(state.window, '#6ee7ff', 1, 0.6);
    ctx.setLineDash([]);
    var self = this;
    state.sections.forEach(function (mesh, i) {
      var selected = self.objects[i].id === self.selected;
      if (!omitObjects) {
        lines(mesh, selected ? '#6ee7ff' : colors[i], selected ? 2.5 : 1.8, 1);
        if (mesh.verts.length === 1) point(mesh.verts[0], colors[i], '', 3);
      }
      if (mesh.verts.length === 1) {
        var tangent = project(mesh.verts[0]);
        if (tangent) { ctx.fillStyle = colors[i]; ctx.fillText('相切点', tangent[0] + 7 * dpi, tangent[1] - 7 * dpi); }
      }
      point(self.objects[i].center, colors[i], self.objects[i].id + (mesh.verts.length ? ' ∩ H' : ' · 无截面'), 2);
    });
    var names = ['Ax', 'Ay', 'Az', 'Aw'], axisColors = ['#fa7777', '#8ce8a8', '#83adff', '#e69bff'];
    names.forEach(function (name, i) {
      var end = M4.add(state.camera, M4.scale(M4.col(state.frame, i), i === 3 ? 2.5 : 1.5));
      lines({ verts: [state.camera, end], edges: [[0, 1]] }, axisColors[i], 1.5, 1);
      point(end, axisColors[i], name, 2);
    });
    point(state.camera, '#ffffff', '相机 c', 4);
    if (state.hit) point(state.hit.point, '#ff82cc', '准星 · ' + state.hit.object.id, 4);
    ctx.fillStyle = '#dbe4f2';
    ctx.fillText('整体投影 · 拖动观察 / 滚轮缩放', 12 * dpi, 22 * dpi);
    ctx.fillStyle = '#6ee7ff';
    ctx.fillText('虚线体框：H 的三维取样窗口', 12 * dpi, H - 44 * dpi);
    ctx.fillStyle = '#8b9ab3';
    ctx.fillText('H: (p-c)·Aw=0 · 实线：物体 ∩ H', 12 * dpi, H - 26 * dpi);
    ctx.fillText('地板无限延伸，概览省略；粉点 = 同一准星命中', 12 * dpi, H - 8 * dpi);
  };

  LinkedView.boxMesh = boxMesh;
  LinkedView.section = section;
  LinkedView.windowMesh = windowMesh;
  global.LinkedView = LinkedView;
})(window);

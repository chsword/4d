/* tools/render-probe.js —— 注入到页面里的渲染探针
 *
 * 必须在所有 js/*.js 之前加载，原因有两个：
 *
 * 1. headless Chromium 没有合成器驱动 requestAnimationFrame —— 实测只触发 3 次
 *    就停了，页面什么都画不出来。所以这里把 rAF 垫成 setTimeout，让
 *    --virtual-time-budget 能把它快进。WebGL 绘制仍然是真实发生的，
 *    只是节拍改由定时器驱动。
 * 2. 要在 WebGLRenderingContext.prototype 上钩住 compileShader / linkProgram，
 *    直接检查 COMPILE_STATUS / LINK_STATUS，才能捕获着色器失败——
 *    应用自己的 try/catch 可能把失败咽掉，只留一个静默的黑屏。
 *
 * 结果写进 document.title，由 tools/verify-render.js 用 --dump-dom 取回。
 */
(function () {
  var report = { errors: [], shaderFails: [], tabs: {}, checks: [] };
  window.__report = report;
  window.addEventListener('error', function (e) { report.errors.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) { report.errors.push('reject: ' + e.reason); });
  var oldErr = console.error;
  console.error = function () {
    report.errors.push(Array.prototype.map.call(arguments, String).join(' '));
    oldErr.apply(console, arguments);
  };

  var rafCbs = 0;
  window.requestAnimationFrame = function (fn) {
    rafCbs++;
    return setTimeout(function () { fn(Date.now()); }, 250);
  };
  window.cancelAnimationFrame = function (id) { clearTimeout(id); };

  /* 强制 preserveDrawingBuffer，否则合成之后 WebGL 缓冲区被清空，
     drawImage 读不到画面，无法判断是否真的画了东西。 */
  var getCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
      attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
      if (diagnostic) { attrs.alpha = true; attrs.premultipliedAlpha = false; }
    }
    return getCtx.call(this, type, attrs);
  };

  var calls = new WeakMap(), diagnostic = null, negativeCanvas = null;
  function count(cv) { calls.set(cv, (calls.get(cv) || 0) + 1); }
  var proto = window.WebGLRenderingContext && WebGLRenderingContext.prototype;
  if (proto) {
    var source = proto.shaderSource;
    proto.shaderSource = function (shader, text) {
      if (diagnostic && text.indexOf('gl_FragColor') >= 0) {
        // Only replace the output encoding. Ray tests execute the production
        // main/trace; map tests execute the production map and actual uniforms.
        var packed = 'float code = floor(t * 65536.0 + 0.5);' +
          'gl_FragColor = vec4(id, floor(code / 65536.0), mod(floor(code / 256.0), 256.0), mod(code, 256.0)) / 255.0;';
        if (diagnostic === 'map') text = text.slice(0, text.lastIndexOf('void main(){')) +
          'void main(){ vec2 h = map(uCam); float id = h.y; float t = h.x + 32.0; ' + packed + '}';
        else text = text.replace('gl_FragColor = vec4(col, 1.0);', packed);
      }
      source.call(this, shader, text);
    };
    var comp = proto.compileShader;
    proto.compileShader = function (s) {
      comp.call(this, s);
      if (!this.getShaderParameter(s, this.COMPILE_STATUS)) {
        report.shaderFails.push(String(this.getShaderInfoLog(s)).slice(0, 400));
      }
    };
    var link = proto.linkProgram;
    proto.linkProgram = function (p) {
      link.call(this, p);
      if (!this.getProgramParameter(p, this.LINK_STATUS)) {
        report.shaderFails.push('LINK: ' + String(this.getProgramInfoLog(p)).slice(0, 300));
      }
    };
    ['drawArrays', 'drawElements'].forEach(function (k) {
      var f = proto[k];
      proto[k] = function () { count(this.canvas); return f.apply(this, arguments); };
    });
  }
  var c2d = CanvasRenderingContext2D.prototype;
  ['stroke', 'fill', 'fillRect', 'fillText', 'drawImage'].forEach(function (k) {
    var f = c2d[k];
    c2d[k] = function () {
      count(this.canvas);
      if (negativeCanvas === this.canvas && (k === 'stroke' || k === 'fill')) return;
      return f.apply(this, arguments);
    };
  });

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* 把画布缩采样进一块 2D 画布，统计颜色数与亮度标准差。
     全黑或全白的标准差都是 0——这是"确实画出了东西"的判据，
     比"绘制调用大于零"更强：调用可能画了一片纯色。 */
  function sample(cv) {
    var off = document.createElement('canvas');
    off.width = Math.min(cv.width, 320);
    off.height = Math.min(cv.height, 240);
    var ctx = getCtx.call(off, '2d');
    ctx.drawImage(cv, 0, 0, off.width, off.height);
    var d = ctx.getImageData(0, 0, off.width, off.height).data;
    var set = Object.create(null), n = 0, sum = 0, sum2 = 0;
    for (var i = 0; i < d.length; i += 4) {
      var L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      set[(d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3)] = 1;
      sum += L; sum2 += L * L; n++;
    }
    var mean = sum / n;
    return {
      colors: Object.keys(set).length,
      mean: +mean.toFixed(1),
      std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1)
    };
  }

  function check(name, ok, detail) { report.checks.push({ name: name, ok: !!ok, detail: detail }); }
  function pixel(view) {
    var gl = view.gl, p = new Uint8Array(4);
    gl.readPixels(Math.floor(view.canvas.width / 2), Math.floor(view.canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU readPixels failed');
    return Array.from(p);
  }
  function decoded(view) {
    var p = pixel(view);
    return { material: p[0], distance: p[1] + p[2] / 256 + p[3] / 65536 };
  }
  function tinyView(mode, make) {
    var cv = document.createElement('canvas'); cv.width = cv.height = 1;
    diagnostic = mode;
    try {
      var v = make(cv);
      if (v.error) throw new Error(v.error);
      v.gl.disable(v.gl.DITHER);
      return v;
    } finally { diagnostic = null; }
  }
  function rayChecks() {
    var scene = Scene4.create([
      { id: 'ball', type: 'sphere', center: [0, 0, -3, 0], params: { r: 1 }, material: 2 }
    ]);
    var view = tinyView('ray', function (cv) { return new SliceView(cv, scene); });
    // Independent analytic roots, including misses, inside start and changed w.
    [[0, 0, 0, 0], [0.6, 0, 0, 0], [0, 0, 0, 0.8],
      [1.1, 0, 0, 0], [0, 0, -3, 0], [0, 0, -5, 0]].forEach(function (origin) {
      view.cam = origin; view.draw();
      var gpu = decoded(view), cpu = scene.raycast(origin, [0, 0, -1, 0]);
      var radius2 = 1 - origin[0] * origin[0] - origin[3] * origin[3];
      var inside = origin[0] * origin[0] + Math.pow(origin[2] + 3, 2) + origin[3] * origin[3] <= 1;
      var hit = inside || radius2 >= 0 && origin[2] + 3 >= Math.sqrt(radius2);
      var exact = inside ? 0 : origin[2] + 3 - Math.sqrt(radius2);
      check('F10 GPU analytic ray ' + origin, gpu.material === (hit ? 2 : 0) &&
        (!hit || Math.abs(gpu.distance - exact) < 0.007), JSON.stringify({ gpu: gpu, exact: exact }));
      check('F10 CPU analytic ray ' + origin, !!cpu === hit &&
        (!hit || Math.abs(cpu.distance - exact) < 0.007), cpu && cpu.distance);
      check('F10 CPU/GPU ray ' + origin, !hit || Math.abs(cpu.distance - gpu.distance) < 0.00005, gpu.distance);
    });
    view.gl.getExtension('WEBGL_lose_context').loseContext();
  }
  function physicsChecks() {
    var view = tinyView('map', function (cv) { return new PhysicsView(cv); });
    view.world.floorY = -3.25;
    var angle = 0.6, c = Math.cos(angle), s = Math.sin(angle);
    view.world.bodies = [
      new RigidBody4({ shape: 'glome', radius: 0.8, position: [-2, 0, -3, 0.2] }),
      new RigidBody4({ halfSize: [0.4, 0.7, 0.9, 1.1], position: [2, 0, -3, -0.2],
        orientation: M4.rotation('xw', angle) })
    ];
    function expect(p, distance, material, label) {
      view.cam = p; view.draw();
      var got = decoded(view); got.distance -= 32;
      check('F19 GPU ' + label, got.material === material && Math.abs(got.distance - distance) < 0.00003, JSON.stringify(got));
    }
    expect([-2, 0, -3, 0.2], -0.8, 2, 'glome center/radius');
    expect([-1.4, 0.6, -3, 0.2], Math.sqrt(0.72) - 0.8, 2, 'glome not box corner');
    expect([-2, 0, -3, 1.2], 0.2, 2, 'glome fourth coordinate');
    [[0, 0, 0, 0], [0.5, 0.8, 0, 0], [0, 0, 0, 1.3], [0, 0, 1, 0]].forEach(function (q) {
      var ds = q.map(function (x, i) { return Math.abs(x) - [0.4, 0.7, 0.9, 1.1][i]; });
      var d = Math.hypot.apply(Math, ds.map(function (x) { return Math.max(x, 0); })) + Math.min(0, Math.max.apply(Math, ds));
      expect([2 + c * q[0] - s * q[3], q[1], -3 + q[2], -0.2 + s * q[0] + c * q[3]], d, 3, 'oriented anisotropic box ' + q);
    });
    expect([0, -3, 0, 0], 0.25, 1, 'nondefault floor');
    view.world.bodies[0].radius = 0.55;
    expect([-2, 0, -3, 0.2], -0.55, 2, 'changed radius is consumed');
    view.world.floorY = -4;
    expect([0, -3, 0, 0], 1, 1, 'changed floor is consumed');
    view.gl.getExtension('WEBGL_lose_context').loseContext();
  }
  function geometryPixels(cv, view, name) {
    var ctx = getCtx.call(cv, '2d'), before = ctx.getImageData(0, 0, cv.width, cv.height).data;
    negativeCanvas = cv;
    try { view.draw(); } finally { negativeCanvas = null; }
    var after = ctx.getImageData(0, 0, cv.width, cv.height).data;
    var W = cv.clientWidth, H = cv.clientHeight;
    // Object regions exclude titles, legends and lower diagnostic charts.
    var regions;
    if (name === 'chirality' || name === 'rings') regions = view.rects.slice(0, 2).map(function (r) {
      return [r.x + 5, r.y + 55, r.w - 10, r.h - 82];
    });
    else if (name === 'analogy') {
      var cols = W >= 700 ? 2 : 1, ph = H / (cols === 2 ? 2 : 4), pw = W / cols;
      regions = [0, 1, 2, 3].map(function (i) { return [i % cols * pw + 10, Math.floor(i / cols) * ph + 65, pw - 20, ph - 80]; });
    } else regions = [[W * 0.1, H * 0.15, W * 0.8, H * 0.6]];
    var sx = cv.width / W, sy = cv.height / H;
    var counts = regions.map(function (r) {
      var count = 0;
      for (var y = Math.ceil(r[1] * sy); y < (r[1] + r[3]) * sy; y++) {
        for (var x = Math.ceil(r[0] * sx); x < (r[0] + r[2]) * sx; x++) {
          var i = 4 * (y * cv.width + x), rgb = [before[i], before[i + 1], before[i + 2]];
          var difference = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
          if (difference > 60 && Math.max.apply(Math, rgb) - Math.min.apply(Math, rgb) > 55 &&
              Math.max.apply(Math, rgb) > 100) count++;
        }
      }
      return count / (sx * sy);
    });
    view.draw();
    return counts;
  }

  window.addEventListener('load', function () {
    (async function () {
      var only = new URLSearchParams(location.search).get('only');
      if (!only || only === 'F10') rayChecks();
      if (!only || only === 'F19') physicsChecks();
      if (only) {
        document.title = 'REPORT>>' + JSON.stringify(report) + '<<END';
        return;
      }
      var views = {};
      [[AnalogyView, 'analogy'], [ProjectionView, 'projection'], [SliceView, 'slice'],
        [PhysicsView, 'physics'], [LinkedView, 'linked'], [ChiralityView, 'chirality'], [RingsView, 'rings']].forEach(function (entry) {
        var draw = entry[0].prototype.draw;
        entry[0].prototype.draw = function () { views[entry[1]] = this; return draw.apply(this, arguments); };
      });
      await wait(600);
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
      for (var i = 0; i < tabs.length; i++) {
        var name = tabs[i].dataset.view;
        tabs[i].click();
        if (name === 'slice') document.getElementById('slice-glome').click();
        var canvases = Array.from(document.querySelectorAll('#stage canvas.active'));
        var before = canvases.map(function (cv) { return calls.get(cv) || 0; });
        await wait(900);
        var view = views[name];
        if (name === 'analogy') { view.spin = false; view.autoK = false; view.k = 0.2; view.draw(); }
        if (name === 'linked') {
          var p0 = pixel(view.slice);
          document.getElementById('linked-w').value = '3';
          document.getElementById('linked-w').dispatchEvent(new Event('input'));
          view.draw();
          var p3 = pixel(view.slice);
          check('F15 linked right wall disappears at w=3',
            p0.slice(0, 3).reduce(function (s, x, i) { return s + Math.abs(x - p3[i]); }, 0) > 60,
            JSON.stringify([p0, p3]));
        }
        report.tabs[name] = canvases.map(function (cv, j) {
          var info = { drawCalls: (calls.get(cv) || 0) - before[j], id: cv.id,
            canvas: cv.id + '@' + cv.width + 'x' + cv.height };
          try { Object.assign(info, sample(cv)); }
          catch (e) { info.sampleError = String(e.message); }
          if (cv.id === 'cv-slice') info.tutorialPixel = pixel(view);
          if (['cv-slice', 'cv-physics', 'cv-linked-slice'].indexOf(cv.id) < 0) {
            info.geometryPixels = geometryPixels(cv, view, name);
          }
          return info;
        });
      }
      report.tabCount = tabs.length;
      report.rafCallbacks = rafCbs;
      document.title = 'REPORT>>' + JSON.stringify(report) + '<<END';
    })().catch(function (e) {
      report.errors.push(e.stack || String(e));
      document.title = 'REPORT>>' + JSON.stringify(report) + '<<END';
    });
  });
})();

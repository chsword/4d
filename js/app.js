/* app.js —— 三个视图的壳：切页签、接控件、跑主循环 */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  var canvases = {
    projection: document.getElementById('cv-projection'),
    slice: document.getElementById('cv-slice'),
    analogy: document.getElementById('cv-analogy')
  };
  var views = {};
  var current = 'analogy';
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function fatal(msg) {
    var el = document.getElementById('fatal');
    el.textContent = msg;
    el.style.display = 'block';
  }

  try {
    views.projection = new ProjectionView(canvases.projection);
    views.analogy = new AnalogyView(canvases.analogy);
  } catch (err) {
    fatal('初始化失败：' + err.message);
    console.error(err);
  }
  // 切片视图要 WebGL；它挂掉不该连累另外两个纯 Canvas 2D 的视图
  try {
    views.slice = new SliceView(canvases.slice);
  } catch (err) {
    views.slice = { error: 'shader 编译失败：' + err.message, draw: function () {} };
    console.error(err);
  }

  /* 切片视图是逐像素 ray marching：每个像素要求几十次四维距离场，
     按 devicePixelRatio 全分辨率渲染在集显上会掉到个位数帧率。
     线框那两个视图是 Canvas 2D，反而需要高 dpr 才不毛糙。 */
  var SCALE = { projection: dpr, analogy: dpr, slice: Math.min(dpr, 1) };

  function resize() {
    var r = stage.getBoundingClientRect();
    for (var k in canvases) {
      var cv = canvases[k], sc = SCALE[k];
      cv.width = Math.max(320, Math.floor(r.width * sc));
      cv.height = Math.max(240, Math.floor(r.height * sc));
      cv.style.width = r.width + 'px';
      cv.style.height = r.height + 'px';
    }
  }
  window.addEventListener('resize', resize);

  /* ---------- 页签 ---------- */
  function select(name) {
    current = name;
    for (var k in canvases) {
      canvases[k].classList.toggle('active', k === name);
    }
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].dataset.view === name);
    }
    var panels = document.querySelectorAll('.panel');
    for (i = 0; i < panels.length; i++) {
      panels[i].classList.toggle('on', panels[i].dataset.view === name);
    }
    if (name !== 'slice' && document.pointerLockElement) document.exitPointerLock();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { select(t.dataset.view); });
  });

  /* ---------- 投影视图控件 ---------- */
  var pv = views.projection;
  if (pv) {
    document.getElementById('shape').addEventListener('change', function () {
      pv.setShape(this.value);
      document.getElementById('projmode').value = pv.mode;
    });
    document.getElementById('projmode').addEventListener('change', function () {
      pv.mode = this.value;
    });
    document.getElementById('eye').addEventListener('input', function () {
      pv.eye = parseFloat(this.value);
      document.getElementById('eye-val').textContent = pv.eye.toFixed(2);
    });
    document.getElementById('colorw').addEventListener('change', function () {
      pv.colorByW = this.checked;
    });
    M4.PLANES.forEach(function (p) {
      var el = document.getElementById('sp-' + p);
      if (!el) return;
      el.value = pv.speeds[p];
      el.addEventListener('input', function () {
        pv.speeds[p] = parseFloat(this.value);
        document.getElementById('spv-' + p).textContent = pv.speeds[p].toFixed(2);
      });
      document.getElementById('spv-' + p).textContent = pv.speeds[p].toFixed(2);
    });
    document.getElementById('proj-stop').addEventListener('click', function () {
      M4.PLANES.forEach(function (p) {
        pv.speeds[p] = 0;
        document.getElementById('sp-' + p).value = 0;
        document.getElementById('spv-' + p).textContent = '0.00';
      });
    });
    document.getElementById('proj-iso').addEventListener('click', function () {
      // 等倾旋转（isoclinic）：两个互相垂直的平面以同一速率转动。
      // 四维独有的现象，看上去像整个形状在"自己里面翻出来"。
      var v = { xy: 0.4, zw: 0.4, xz: 0, yz: 0, xw: 0, yw: 0 };
      M4.PLANES.forEach(function (p) {
        pv.speeds[p] = v[p];
        document.getElementById('sp-' + p).value = v[p];
        document.getElementById('spv-' + p).textContent = v[p].toFixed(2);
      });
    });
  }

  /* ---------- 切片视图控件 ---------- */
  var sv = views.slice;
  if (sv && !sv.error) {
    window.addEventListener('keydown', function (e) {
      if (current !== 'slice') return;
      sv.keys[e.code.toLowerCase()] = true;
      if (['keyw', 'keya', 'keys', 'keyd', 'space'].indexOf(e.code.toLowerCase()) >= 0) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', function (e) { sv.keys[e.code.toLowerCase()] = false; });
    window.addEventListener('blur', function () { sv.keys = {}; });

    document.getElementById('wtint').addEventListener('change', function () {
      sv.wTint = this.checked;
    });
    document.getElementById('xray').addEventListener('change', function () {
      sv.xray = this.checked;
    });
    document.getElementById('slice-reset').addEventListener('click', function () {
      sv.cam = [0, 0.4, 0, 0]; sv.yaw = 0; sv.pitch = 0; sv.resetW();
    });
    document.getElementById('wslider').addEventListener('input', function () {
      sv.cam[3] = parseFloat(this.value);
    });
  } else if (sv && sv.error) {
    document.getElementById('slice-note').textContent = sv.error;
  }

  /* ---------- 类比视图控件 ---------- */
  var av = views.analogy;
  if (av) {
    document.getElementById('kslider').addEventListener('input', function () {
      av.k = parseFloat(this.value);
      av.autoK = false;
      document.getElementById('autok').checked = false;
    });
    document.getElementById('autok').addEventListener('change', function () {
      av.autoK = this.checked;
    });
    document.getElementById('spin').addEventListener('change', function () {
      av.spin = this.checked;
    });
  }

  /* ---------- 主循环 ---------- */
  var last = performance.now();
  var hud = document.getElementById('hud');
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var v = views[current];
    if (v) {
      if (v.step) v.step(dt);
      v.draw();
    }
    if (current === 'slice' && sv && !sv.error) {
      hud.style.display = 'block';
      hud.innerHTML =
        'w = <b>' + sv.cam[3].toFixed(2) + '</b>' +
        ' &nbsp;|&nbsp; xw = ' + (sv.a_xw * 57.2958).toFixed(0) + '°' +
        ' &nbsp;|&nbsp; zw = ' + (sv.a_zw * 57.2958).toFixed(0) + '°' +
        ' &nbsp;|&nbsp; xyz = (' + sv.cam[0].toFixed(1) + ', ' + sv.cam[1].toFixed(1) + ', ' + sv.cam[2].toFixed(1) + ')' +
        (sv.locked ? '' : ' &nbsp;·&nbsp; <span class="hint">点画面锁定鼠标</span>');
      var ws = document.getElementById('wslider');
      if (document.activeElement !== ws) ws.value = sv.cam[3];
    } else {
      hud.style.display = 'none';
    }
    requestAnimationFrame(frame);
  }

  resize();
  select('analogy');
  requestAnimationFrame(frame);
})();

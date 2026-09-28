/* app.js —— 视图的壳：切页签、接控件、跑主循环 */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  var canvases = {
    projection: document.getElementById('cv-projection'),
    slice: document.getElementById('cv-slice'),
    analogy: document.getElementById('cv-analogy'),
    physics: document.getElementById('cv-physics'),
    linked: document.getElementById('cv-linked'),
    linkedSlice: document.getElementById('cv-linked-slice'),
    chirality: document.getElementById('cv-chirality'),
    rings: document.getElementById('cv-rings'),
    net: document.getElementById('cv-net'),
    simplex: document.getElementById('cv-simplex')
  };
  var views = {};
  var current = 'analogy';
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function fatal(msg) {
    var el = document.getElementById('fatal');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function showViewError() {
    var v = views[current], el = document.getElementById('fatal');
    el.style.display = v && v.error ? 'block' : 'none';
    var recovery = ['physics', 'slice', 'linked'].indexOf(current) >= 0
      ? '；请使用本页复位按钮重试；初始化失败需刷新页面。' : '；请刷新页面重试。';
    el.textContent = v && v.error ? '视图运行失败：' + v.error + recovery : '';
  }
  function resetView(v, reset) {
    try {
      reset();
      v.error = null;
    } catch (err) {
      v.error = err.message;
      console.error(err);
    }
    showViewError();
  }

  try {
    views.projection = new ProjectionView(canvases.projection);
    views.analogy = new AnalogyView(canvases.analogy);
  } catch (err) {
    if (!views.projection) views.projection = { error: '初始化失败：' + err.message };
    if (!views.analogy) views.analogy = { error: '初始化失败：' + err.message };
    fatal('初始化失败：' + err.message);
    console.error(err);
  }
  try {
    views.physics = new PhysicsView(canvases.physics);
  } catch (err) {
    views.physics = { error: '物理视图初始化失败：' + err.message };
    console.error(err);
  }
  // 切片视图要 WebGL；它挂掉不该连累另外两个纯 Canvas 2D 的视图
  try {
    views.slice = new SliceView(canvases.slice);
  } catch (err) {
    views.slice = { error: 'shader 编译失败：' + err.message, draw: function () {} };
    console.error(err);
  }
  try {
    views.linked = new LinkedView(canvases.linked, canvases.linkedSlice);
  } catch (err) {
    views.linked = { error: '联动视图初始化失败：' + err.message };
    console.error(err);
  }
  try {
    views.chirality = new ChiralityView(canvases.chirality);
  } catch (err) {
    views.chirality = { error: '手性视图初始化失败：' + err.message };
    console.error(err);
  }
  try {
    views.rings = new RingsView(canvases.rings);
  } catch (err) {
    views.rings = { error: '双环视图初始化失败：' + err.message };
    console.error(err);
  }
  try {
    views.net = new NetView(canvases.net);
  } catch (err) {
    views.net = { error: '八胞折叠初始化失败：' + err.message };
    console.error(err);
  }
  try {
    views.simplex = new SimplexView(canvases.simplex);
  } catch (err) {
    views.simplex = { error: '等距点初始化失败：' + err.message };
    console.error(err);
  }

  /* 切片视图是逐像素 ray marching：每个像素要求几十次四维距离场，
     按 devicePixelRatio 全分辨率渲染在集显上会掉到个位数帧率。
     线框那两个视图是 Canvas 2D，反而需要高 dpr 才不毛糙。 */
  var SCALE = { projection: dpr, analogy: dpr, slice: Math.min(dpr, 1), physics: Math.min(dpr, 1),
    linked: dpr, linkedSlice: Math.min(dpr, 1), chirality: dpr, rings: dpr, net: dpr, simplex: dpr };

  function resize() {
    stage.style.minHeight = '';
    var r = stage.getBoundingClientRect();
    if (current === 'analogy') {
      stage.style.minHeight = r.width < 700 ? '1200px' : '600px';
      r = stage.getBoundingClientRect();
    }
    // 用实际画布宽度决定纵排高度，避免滚动条让 CSS 断点与画面断点错位。
    if (current === 'chirality' && r.width < 680) {
      stage.style.minHeight = '1240px';
      r = stage.getBoundingClientRect();
    }
    if (current === 'rings' && r.width < 700) {
      stage.style.minHeight = '1420px';
      r = stage.getBoundingClientRect();
    }
    if (current === 'net' && r.width < 680) {
      stage.style.minHeight = '1300px';
      r = stage.getBoundingClientRect();
    }
    if (current === 'simplex') {
      stage.style.minHeight = r.width < 680 ? '1150px' : '890px';
      document.getElementById('simplex-distances').style.top = r.width < 680 ? '780px' : '516px';
      r = stage.getBoundingClientRect();
    }
    for (var k in canvases) {
      var cv = canvases[k], sc = SCALE[k];
      var linked = k === 'linked' || k === 'linkedSlice', stacked = window.innerWidth <= 640;
      var width = linked && !stacked ? r.width / 2 : r.width;
      var height = linked && stacked ? r.height / 2 : r.height;
      cv.width = Math.max(1, Math.floor(width * sc));
      cv.height = Math.max(1, Math.floor(height * sc));
      cv.style.width = width + 'px';
      cv.style.height = height + 'px';
      cv.style.left = k === 'linkedSlice' && !stacked ? width + 'px' : '0';
      cv.style.top = k === 'linkedSlice' && stacked ? height + 'px' : '0';
    }
  }
  window.addEventListener('resize', resize);

  /* ---------- 页签 ---------- */
  function select(name) {
    if (views.slice) views.slice.keys = {};
    if (views.linked && views.linked.slice) views.linked.slice.keys = {};
    if (views.physics && views.physics.clearInput && !views.physics.error) views.physics.clearInput();
    if (views.chirality && !views.chirality.error) views.chirality.clearInput();
    if (views.rings && !views.rings.error) views.rings.clearInput();
    if (views.net && !views.net.error) views.net.clearInput();
    current = name;
    for (var k in canvases) {
      canvases[k].classList.toggle('active', k === name || (name === 'linked' && k === 'linkedSlice'));
    }
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].dataset.view === name);
    }
    var panels = document.querySelectorAll('.panel');
    for (i = 0; i < panels.length; i++) {
      panels[i].classList.toggle('on', panels[i].dataset.view === name);
    }
    var inputCanvas = name === 'linked' ? canvases.linkedSlice : canvases[name];
    if (document.pointerLockElement && document.pointerLockElement !== inputCanvas) document.exitPointerLock();
    stage.classList.toggle('linked', name === 'linked');
    stage.classList.toggle('chirality', name === 'chirality');
    stage.classList.toggle('rings', name === 'rings');
    stage.classList.toggle('net', name === 'net');
    stage.classList.toggle('simplex', name === 'simplex');
    resize();
    showViewError();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { select(t.dataset.view); });
  });

  /* ---------- 投影视图控件 ---------- */
  var pv = views.projection;
  if (pv && !pv.error) {
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
      pv.startIsoclinic();
      M4.PLANES.forEach(function (p) {
        document.getElementById('sp-' + p).value = pv.speeds[p];
        document.getElementById('spv-' + p).textContent = pv.speeds[p].toFixed(2);
      });
    });
  }

  /* ---------- 切片视图控件 ---------- */
  var sv = views.slice;
  var lv = views.linked;
  function activeSlice() {
    if (current === 'slice' && sv && !sv.error) return sv;
    if (current === 'linked' && lv && !lv.error) return lv.slice;
    return null;
  }
  window.addEventListener('keydown', function (e) {
    var v = activeSlice();
    if (!v || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyR', 'KeyF',
      'KeyC', 'Space', 'ShiftLeft', 'ShiftRight'].indexOf(e.code) < 0) return;
    e.preventDefault();
    v.keys[e.code.toLowerCase()] = true;
  });
  function clearSliceInput() {
    if (sv) sv.keys = {};
    if (lv && lv.slice) lv.slice.keys = {};
  }
  window.addEventListener('keyup', function (e) {
    if (sv && sv.keys) sv.keys[e.code.toLowerCase()] = false;
    if (lv && lv.slice) lv.slice.keys[e.code.toLowerCase()] = false;
  });
  window.addEventListener('blur', clearSliceInput);
  document.addEventListener('visibilitychange', function () { if (document.hidden) clearSliceInput(); });
  if (sv && !sv.error) {
    document.getElementById('wtint').addEventListener('change', function () {
      sv.wTint = this.checked;
    });
    document.getElementById('xray').addEventListener('change', function () {
      sv.xray = this.checked;
    });
    document.getElementById('slice-reset').addEventListener('click', function () {
      resetView(sv, function () { sv.resetCamera(); });
      this.blur();
    });
    document.getElementById('slice-glome').addEventListener('click', function () {
      resetView(sv, function () { sv.startGlomeExperiment(); });
      document.getElementById('wtint').checked = sv.wTint;
      document.getElementById('xray').checked = sv.xray;
      this.blur();
    });
    document.getElementById('wslider').addEventListener('input', function () {
      sv.setW(parseFloat(this.value));
      this.value = sv.cam[3];
    });
  } else if (sv && sv.error) {
    document.getElementById('slice-note').textContent = sv.error;
  }

  /* ---------- 联动：共用相机状态，不同步两套角度 ---------- */
  if (lv && !lv.error) {
    document.getElementById('linked-w').addEventListener('input', function () {
      lv.slice.setW(parseFloat(this.value)); this.value = lv.slice.cam[3];
    });
    document.getElementById('linked-object').addEventListener('change', function () { lv.selected = this.value; });
    document.getElementById('linked-reset').addEventListener('click', function () {
      resetView(lv, function () { lv.reset(); });
      document.getElementById('linked-answer').textContent = '已回到墙前；先预测下一层，再揭示。';
    });
    function predict(exists) {
      var w = parseFloat(document.getElementById('linked-next-w').value), result = lv.predict(w, exists);
      document.getElementById('linked-answer').textContent = result.reached
        ? (result.correct ? '预测正确：' : '预测不符：') + lv.selected + ' 在 w=' + w + (result.exists ? ' 有截面。' : ' 无截面。')
        : '移动被碰撞阻挡，未到目标 w；请先退离物体再预测。当前截面不是目标层的结果。';
    }
    document.getElementById('linked-yes').addEventListener('click', function () { predict(true); });
    document.getElementById('linked-no').addEventListener('click', function () { predict(false); });
  } else if (lv && lv.error) {
    document.getElementById('linked-note').textContent = lv.error;
  }

  /* ---------- 物理视图控件 ---------- */
  var ph = views.physics;
  if (ph && !ph.error) {
    function physicsSlider(id, object, property, scale, digits) {
      var el = document.getElementById(id), val = document.getElementById(id + '-val');
      function update() {
        object[property] = parseFloat(el.value) * scale;
        val.textContent = parseFloat(el.value).toFixed(digits);
        ph.accumulator = 0;
      }
      el.addEventListener('input', update);
      update();
    }
    physicsSlider('physics-gravity', ph.world, 'gravity', 1, 1);
    physicsSlider('physics-restitution', ph.world, 'restitution', 1, 2);
    physicsSlider('physics-friction', ph.world, 'friction', 1, 2);
    physicsSlider('physics-step', ph, 'timeStep', 0.001, 0);
    document.getElementById('physics-capacity').textContent =
      '最多保留 ' + ph.maxBodies + ' 个刚体，满额后替换最早的一个。';
    window.addEventListener('keydown', function (e) {
      if (current !== 'physics') return;
      if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyR', 'KeyF',
        'KeyV', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight'].indexOf(e.code) < 0) return;
      e.preventDefault();
      ph.keyDown(e);
    });
    window.addEventListener('keyup', function (e) { ph.keyUp(e); });
    window.addEventListener('blur', function () { ph.clearInput(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) ph.clearInput();
    });
    // 从按钮切入后，点击画面把焦点交还给漫游操作，避免 Space 再次触发按钮。
    canvases.physics.addEventListener('click', function () {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    document.getElementById('physics-pause').addEventListener('change', function () { ph.paused = this.checked; });
    document.getElementById('physics-spawn').addEventListener('click', function () { ph.spawn(); });
    document.getElementById('physics-reset').addEventListener('click', function () {
      resetView(ph, function () { ph.resetScene(); });
      document.getElementById('physics-status').textContent = ph.solverWarning;
    });
    document.getElementById('physics-camera').addEventListener('click', function () { ph.resetCamera(); });
    document.getElementById('physics-w').addEventListener('input', function () { ph.cam[3] = parseFloat(this.value); });
    document.getElementById('physics-wtint').addEventListener('change', function () { ph.wTint = this.checked; });
    document.getElementById('physics-xray').addEventListener('change', function () { ph.xray = this.checked; });
  } else if (ph && ph.error) {
    document.getElementById('physics-note').textContent = ph.error;
  }

  /* ---------- 手性：控件只改旋转角；误差始终由同一组材料坐标算出 ---------- */
  var ch = views.chirality;
  if (ch && !ch.error) {
    var ce = {};
    Array.prototype.forEach.call(document.querySelectorAll('[id^="ch-"]'), function (el) { ce[el.id.slice(3)] = el; });
    ['xy', 'xz', 'yz'].forEach(function (plane) {
      ce[plane].addEventListener('input', function () { ch.angles[plane] = Number(this.value) * Math.PI / 180; });
    });
    function pose3(xz) {
      ch.angles = { xy: 0, xz: xz, yz: 0 };
      ['xy', 'xz', 'yz'].forEach(function (p) { ce[p].value = ch.angles[p] * 180 / Math.PI; });
    }
    ce.best.addEventListener('click', function () { pose3(Math.PI); });
    ce.reset3.addEventListener('click', function () { pose3(0); });
    function pose4(angle) { ch.theta = angle; ch.playing = false; ce.angle.value = angle * 180 / Math.PI; }
    ce.angle.addEventListener('input', function () { pose4(Number(this.value) * Math.PI / 180); });
    ce.start.addEventListener('click', function () { pose4(0); });
    ce.middle.addEventListener('click', function () { pose4(Math.PI / 2); });
    ce.end.addEventListener('click', function () { pose4(Math.PI); });
    ce.play.addEventListener('click', function () {
      if (ch.theta === Math.PI) ch.theta = 0;
      ch.playing = !ch.playing;
    });
    ce.camera.addEventListener('change', function () { ch.camera = this.value; });
    ce.target.addEventListener('change', function () { ch.showTarget = this.checked; });
    var pointCells = Chirality4.markers.map(function (m, i) {
      var option = document.createElement('option'); option.value = i; option.textContent = m.id + ' · ' + m.name;
      ce.marker.appendChild(option);
      var row = ce.points.querySelector('tbody').insertRow();
      row.insertCell().textContent = m.id + ' ' + m.name;
      return [row.insertCell(), row.insertCell()];
    });
    ce.marker.addEventListener('change', function () { ch.selected = Number(this.value); });
    ce.bound.textContent = (100 * Chirality4.lowerBound).toFixed(6) + '%';
    function scientific(n) { return n.toExponential(2); }
    function errorText(e) { return e < 1e-8 ? scientific(e) + '（浮点残差）' : (100 * e).toFixed(6) + '%'; }
    function text(id, value) { if (ce[id].textContent !== value) ce[id].textContent = value; }
    ch.onUpdate = function (s) {
      text('det', '+' + s.det.toFixed(12));
      text('volume', s.volume.toFixed(12));
      text('distance', s.distance.toFixed(12));
      text('projected', (s.projectedVolume / ch.initialVolume).toFixed(9));
      text('volume-drift', scientific(s.volume - ch.initialVolume));
      text('distance-drift', scientific(s.distance - Chirality4.referenceLength));
      text('det-drift', scientific(s.det - 1));
      text('error3', errorText(s.e3)); text('error4', errorText(s.e4));
      text('angle-val', (ch.theta * 180 / Math.PI).toFixed(1) + '°');
      ce.angle.value = ch.theta * 180 / Math.PI;
      text('play', ch.playing ? '暂停' : ch.theta === Math.PI ? '重新播放' : '播放一次');
      ['xy', 'xz', 'yz'].forEach(function (p) {
        ce[p].value = ch.angles[p] * 180 / Math.PI;
        text(p + '-val', (ch.angles[p] * 180 / Math.PI).toFixed(1) + '°');
      });
      pointCells.forEach(function (cells, i) {
        [s.errors3[i], s.errors4[i]].forEach(function (error, j) {
          var value = scientific(error / Chirality4.referenceLength);
          if (cells[j].textContent !== value) cells[j].textContent = value;
        });
      });
      var rows = [];
      for (var r = 0; r < 4; r++) rows.push(s.r4.slice(r * 4, r * 4 + 4).map(function (v) {
        return (v >= 0 ? ' ' : '') + v.toFixed(4);
      }).join(' '));
      text('matrix', rows.join('\n'));
      text('status', ch.theta === Math.PI
        ? '已匹配：所有材料点回到 w≈0；数学终点精确重合，读数保留浮点残差。'
        : Math.abs(ch.theta - Math.PI / 2) < 0.04
          ? '看下方两图：宽度转入 w，没有压扁。xyz 定向体积过零，材料体积不变。'
          : '先试左边，再把 θ 推到 90° 和 180°；掌心 P 始终是同一个材料点。');
    };
  } else if (ch && ch.error) {
    document.getElementById('ch-note').textContent = ch.error;
  }

  /* ---------- 双环：三维请求先经过首次接触限制；四维只走 A02 路径 ---------- */
  var rg = views.rings;
  if (rg && !rg.error) {
    var re = {};
    Array.prototype.forEach.call(document.querySelectorAll('[id^="rg-"]'), function (el) { re[el.id.slice(3)] = el; });
    re.pull.addEventListener('input', function () { rg.request3 = Number(this.value); });
    re.attempt.addEventListener('click', function () { rg.request3 = 3; });
    re.reset3.addEventListener('click', function () { rg.request3 = 0; });
    re.mode.addEventListener('change', function () { rg.setMode(this.value === 'omit'); });
    re.time.addEventListener('input', function () { rg.seek(Number(this.value)); });
    re.start.addEventListener('click', function () { rg.seek(0); });
    re.end.addEventListener('click', function () { rg.seek(3); });
    re.crossing.addEventListener('click', function () {
      rg.setMode(false); re.mode.value = 'full'; rg.seek(Rings4.crossingTime);
    });
    re.play.addEventListener('click', function () {
      if (rg.t === 3) rg.seek(0);
      rg.playing = !rg.playing;
    });
    re.camera.addEventListener('change', function () { rg.camera = this.value; });
    document.addEventListener('visibilitychange', function () { if (document.hidden) rg.clearInput(); });
    function ringText(id, value) { if (re[id].textContent !== value) re[id].textContent = value; }
    rg.onUpdate = function (s) {
      var p = s.pose, q = s.closest;
      re.time.value = rg.t; re.pull.value = rg.request3;
      ringText('time-val', rg.t.toFixed(3)); ringText('pull-val', rg.request3.toFixed(3));
      ringText('play', rg.playing ? '暂停' : '播放');
      ringText('distance', q.distance.toFixed(6) + ' > 0.200000');
      var formula = rg.omitTranslation || p.stage === 1 ? '√(1+w²)' : p.stage === 2 ? '1' : '2';
      ringText('bound', '≥ ' + formula + ' = ' + p.bound.toFixed(6));
      ringText('witness', 'wA=0.000 · wB=' + q.b[3].toFixed(3) + '\ndxyz=' + q.projected.toFixed(6));
      ringText('gap', (q.distance - 0.2).toFixed(6) + '\n保证 ≥ ' + (p.bound - 0.2).toFixed(6));
      ringText('capsules', '[' + s.capsules.curveLower.toFixed(6) + ', ' + s.capsules.curveUpper.toFixed(6) + ']');
      ringText('contact', '实际 x=' + s.pose3.x.toFixed(6) + '，d₃=' + s.closest3.distance.toFixed(6)
        + (s.pose3.contact ? ' = 2ρ：管面接触，停止。链环数仍为 −1。' : ' > 2ρ：尚未接触，仍套扣。'));
      ringText('status', rg.t === 3
        ? rg.omitTranslation ? '失败：已回到 w=0 的原构型，链环数仍为 −1。安全升降不等于解环。'
          : '已分离：两环回到 w=0；B 的 x 范围 [3,5]，链环数 0。'
        : !rg.omitTranslation && Math.abs(rg.t - Rings4.crossingTime) < 1e-12
          ? 'xyz 真正相交！A(0)、B(π) 的 w 分别为 0、1，d₄=1 > 0.2；看下方 xw 尺。'
          : rg.omitTranslation ? '省掉第二段平移：只升降，最终还是同一个链环。'
            : '三段均有连续安全下界；第二段的 xyz 重影不代表四维接触。');
    };
  } else if (rg && rg.error) {
    document.getElementById('rg-note').textContent = rg.error;
  }

  /* ---------- 八胞：控件只改进度/观察方向，不改材料坐标 ---------- */
  var nt = views.net;
  if (nt && !nt.error) {
    var ne = {};
    Array.prototype.forEach.call(document.querySelectorAll('[id^="nt-"]'), function (el) { ne[el.id.slice(3)] = el; });
    Net4.cells.forEach(function (cell, i) {
      var option = document.createElement('option');
      option.value = i; option.textContent = (i + 1) + ' ' + cell.id + ' · 终态 ' + cell.fixed;
      ne.cell.appendChild(option);
    });
    var seamRows = nt.seams.map(function (seam, i) {
      var label = nt.seamLabel(seam), option = document.createElement('option');
      option.value = i; option.textContent = label + (seam.retained ? ' · 铰链' : ' · 新接缝');
      ne.seam.appendChild(option);
      var row = ne.pairs.querySelector('tbody').insertRow();
      row.insertCell().textContent = label;
      row.insertCell().textContent = seam.retained ? '保留' : '新接';
      return row.insertCell();
    });
    ne.time.addEventListener('input', function () { nt.seek(Number(this.value)); });
    ne.start.addEventListener('click', function () { nt.seek(0); });
    ne.middle.addEventListener('click', function () { nt.seek(0.5); });
    ne.end.addEventListener('click', function () { nt.seek(1); });
    ne.play.addEventListener('click', function () {
      if (nt.t === 1) nt.seek(0);
      nt.playing = !nt.playing;
    });
    ne.cell.addEventListener('change', function () { nt.selectCell(Number(this.value)); });
    ne.home.addEventListener('click', function () { nt.selectCell(0); });
    ne.seam.addEventListener('change', function () {
      nt.seam = Number(this.value);
      var seam = nt.seams[nt.seam];
      if (nt.selected !== seam.a.cell && nt.selected !== seam.b.cell) nt.selectCell(seam.a.cell);
    });
    ne.mode.addEventListener('change', function () { nt.mode = this.value; });
    ne.yaw.addEventListener('input', function () { nt.camYaw = Number(this.value) * Math.PI / 180; });
    ne.pitch.addEventListener('input', function () { nt.camPitch = Number(this.value) * Math.PI / 180; });
    document.addEventListener('visibilitychange', function () { if (document.hidden) nt.clearInput(); });
    function netText(id, value) { if (ne[id].textContent !== value) ne[id].textContent = value; }
    nt.onUpdate = function (s) {
      var g = s.geometry, cell = Net4.cells[nt.selected], retained = 0, joined = 0;
      g.gaps.forEach(function (gap, i) {
        var max = Math.max.apply(Math, gap), closed = max <= Net4.tolerance;
        if (closed) { if (nt.seams[i].retained) retained++; else joined++; }
        var value = max.toExponential(2) + (closed ? ' 合' : ' 开');
        if (seamRows[i].textContent !== value) seamRows[i].textContent = value;
      });
      ne.time.value = nt.t; ne.cell.value = nt.selected; ne.seam.value = nt.seam;
      netText('time-val', (100 * nt.t).toFixed(1) + '%');
      netText('play', nt.playing ? '暂停' : nt.t === 0.5 ? '继续合盖' : '播放一次');
      netText('angles', 'θ=' + (s.angles.theta * 180 / Math.PI).toFixed(2) + '° · φ=' +
        (s.angles.phi * 180 / Math.PI).toFixed(2) + '°');
      netText('identity', (nt.selected + 1) + ' ' + cell.id + ' · 终态 ' + cell.fixed + '\nP/Q 始终属于这块胞');
      netText('rigid', '全部 224 点对 Δmax=' + g.drift.toExponential(2) + '\n|PQ|₄=' + s.distance.toFixed(12));
      netText('joined', '铰链 ' + retained + '/7 · 新接合 ' + joined + '/17\n未接合 ' + (24 - g.joined) + ' 对');
      netText('point', s.points.map(function (p, i) {
        return Net4.markers[i].id + '=(' + p.map(function (v) { return v.toFixed(4); }).join(', ') + ')';
      }).join('\n'));
      netText('status', nt.t === 0 ? '展开：八个三维立方体都在 w=0；保留 7 张铰链面，另有 17 对面待接。'
        : nt.t < 0.5 ? '阶段一：六侧胞外翻；H 由 E 带动。整张正方形是铰链，不是某一条棱。'
          : nt.t < 1 ? '六侧胞已折好；H 从 w≥2 的外侧合盖。相接是面粘合，不是胞内部穿透。'
            : '闭合：48 张胞面逐一配成 24 对，无敞口；32 棱各归 3 胞，16 顶点各归 4 胞。');
    };
  } else if (nt && nt.error) {
    document.getElementById('nt-note').textContent = nt.error;
  }

  /* ---------- 等距点：材料读数与投影分离，揭示答案不冒充迁移通过 ---------- */
  var sx = views.simplex;
  if (sx && !sx.error) {
    var se = {}, distanceRows = [];
    Array.prototype.forEach.call(document.querySelectorAll('[id^="sx-"]'), function (el) { se[el.id.slice(3)] = el; });
    function simplexText(id, text) { if (se[id].textContent !== text) se[id].textContent = text; }
    ['x', 'y', 'z', 'w'].forEach(function (axis, i) {
      se[axis].addEventListener('input', function () { sx.setCoordinate(i, Number(this.value)); });
    });
    se.best.addEventListener('click', function () { sx.best(); });
    se.center.addEventListener('click', function () { sx.center(); });
    se.unlock.addEventListener('change', function () { sx.unlock(this.checked); });
    se.positive.addEventListener('click', function () { sx.reveal(1); });
    se.negative.addEventListener('click', function () { sx.reveal(-1); });
    ['size', 'rotation', 'low'].forEach(function (kind) {
      se[kind].addEventListener('click', function () { sx.startChallenge(kind); se.prediction.value = ''; });
    });
    se.check.addEventListener('click', function () { sx.checkTransfer(se.prediction.value); });
    se.mode.addEventListener('change', function () { sx.mode = this.value; });
    se.yaw.addEventListener('input', function () { sx.camYaw = Number(this.value) * Math.PI / 180; });
    se.pitch.addEventListener('input', function () { sx.camPitch = Number(this.value) * Math.PI / 180; });
    sx.onUpdate = function (s) {
      var m = s.model, evidence = s.evidence, body = se.table.querySelector('tbody');
      while (distanceRows.length > evidence.rows.length) { body.deleteRow(-1); distanceRows.pop(); }
      while (distanceRows.length < evidence.rows.length) {
        var row = body.insertRow(); distanceRows.push([row.insertCell(), row.insertCell(), row.insertCell()]);
      }
      function label(i) { return i === m.dimension + 1 ? 'P' : 'ABCD'[i]; }
      evidence.rows.forEach(function (row, i) {
        var values = [label(row.a) + label(row.b), row.distance.toFixed(12), (100 * row.error).toFixed(6) + '%'];
        values.forEach(function (value, j) { if (distanceRows[i][j].textContent !== value) distanceRows[i][j].textContent = value; });
      });
      ['x', 'y', 'z', 'w'].forEach(function (axis, i) {
        se[axis].min = -3.5 * sx.size; se[axis].max = 3.5 * sx.size;
        se[axis].step = 0.001 * sx.size; se[axis].value = sx.p[i];
        se[axis].disabled = i > m.dimension || i === m.dimension && !sx.unlocked;
        simplexText(axis + '-val', sx.p[i].toFixed(4));
      });
      se.unlock.checked = sx.unlocked;
      simplexText('unlock-label', m.dimension === 3 ? '开放 w' : '开放 z');
      simplexText('task', m.dimension === 3
        ? '固定四面体 ABCD，移动第五点 P，让十条点对距离全部等于基底边长 L。先只用 x/y/z，再开放 w。'
        : '低维重做：固定 xy 平面内的三角形 ABC，移动第四点 P，让六条点对距离全部等于边长 L。先只用 x/y，再开放 z；w 始终锁定。');
      simplexText('best', m.dimension === 3 ? '最佳三维姿态' : '最佳平面位置');
      simplexText('caption', (m.dimension === 3 ? '全部十条' : '全部六条') + '点对 · 真实四维距离（不是屏幕长度）');
      simplexText('target', 'L=' + m.edge.toFixed(6) + ' · R=' + m.radius.toFixed(6) + ' · 尺寸 s=' + sx.size.toFixed(2));
      simplexText('error', '当前 E=' + (100 * evidence.maxError).toFixed(6) + '% · ' +
        (m.dimension === 3 ? '三维' : '平面') + '全局下界 ' + (100 * s.bound).toFixed(6) + '%');
      simplexText('status', evidence.exact ? '机器精度精确解：全部点对等长。' : evidence.success ? '近似达标（≤1%），不是精确等距。'
        : sx.unlocked ? '尚未达标；必须同时匹配基底边长。' : '额外方向锁定：误差不可能降到零。');
      simplexText('points', evidence.points.map(function (p, i) {
        return label(i) + '=(' + p.map(function (v) { return v.toFixed(6); }).join(', ') + ')';
      }).join('\n'));
      simplexText('feedback', sx.feedback);
      simplexText('progress', ['size', 'rotation', 'low'].map(function (kind, i) {
        return ['尺寸', '旋转', '低维'][i] + '：' + (sx.completed[kind] ? '通过' : '待完成');
      }).join(' · '));
    };
  }

  /* ---------- 类比视图控件 ---------- */
  var av = views.analogy;
  if (av && !av.error) {
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
    showViewError();
    if (v && !v.error) {
      try {
        if (v.step) v.step(dt);
        v.draw();
      } catch (err) {
        v.error = err.message;
        if (v.clearInput) v.clearInput();
        else if (v.keys) v.keys = {};
        showViewError();
        console.error(err);
      }
    }
    if ((current === 'slice' || current === 'physics') && v && !v.error) {
      hud.style.display = 'block';
      hud.innerHTML =
        'w = <b>' + v.cam[3].toFixed(2) + '</b>' +
        ' &nbsp;|&nbsp; xw = ' + (v.a_xw * 57.2958).toFixed(0) + '°' +
        ' &nbsp;|&nbsp; zw = ' + (v.a_zw * 57.2958).toFixed(0) + '°' +
        ' &nbsp;|&nbsp; xyz = (' + v.cam[0].toFixed(1) + ', ' + v.cam[1].toFixed(1) + ', ' + v.cam[2].toFixed(1) + ')' +
        (current === 'physics' ? ' &nbsp;|&nbsp; 刚体 ' + ph.world.bodies.length + '/' + ph.maxBodies +
          (ph.paused ? ' · 已暂停' : '') +
          (ph.skippedFrames ? '<br>已跳过 ' + ph.skippedFrames + ' 帧 / ' + ph.skippedTime.toFixed(3) +
            ' 秒 · ' + ph.solverWarning : '') : '') +
        (v.locked ? '' : ' &nbsp;·&nbsp; <span class="hint">' + (v.pointerError || '点画面锁定鼠标') + '</span>');
      var ws = document.getElementById(current === 'physics' ? 'physics-w' : 'wslider');
      if (document.activeElement !== ws) ws.value = v.cam[3];
      if (current === 'physics') document.getElementById('physics-status').textContent = ph.solverWarning;
    } else {
      hud.style.display = 'none';
    }
    requestAnimationFrame(frame);
  }

  resize();
  select('analogy');
  requestAnimationFrame(frame);
})();

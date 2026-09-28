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
    rings: document.getElementById('cv-rings')
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

  /* 切片视图是逐像素 ray marching：每个像素要求几十次四维距离场，
     按 devicePixelRatio 全分辨率渲染在集显上会掉到个位数帧率。
     线框那两个视图是 Canvas 2D，反而需要高 dpr 才不毛糙。 */
  var SCALE = { projection: dpr, analogy: dpr, slice: Math.min(dpr, 1), physics: Math.min(dpr, 1),
    linked: dpr, linkedSlice: Math.min(dpr, 1), chirality: dpr, rings: dpr };

  function resize() {
    stage.style.minHeight = '';
    var r = stage.getBoundingClientRect();
    // 用实际画布宽度决定纵排高度，避免滚动条让 CSS 断点与画面断点错位。
    if (current === 'chirality' && r.width < 680) {
      stage.style.minHeight = '1240px';
      r = stage.getBoundingClientRect();
    }
    if (current === 'rings' && r.width < 700) {
      stage.style.minHeight = '1420px';
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
    resize();
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
      sv.cam = [0, 0.4, 0, 0]; sv.yaw = 0; sv.pitch = 0; sv.resetW();
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
      lv.reset();
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
    document.getElementById('physics-reset').addEventListener('click', function () { ph.resetScene(); });
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
    if (v && !v.error) {
      try {
        if (v.step) v.step(dt);
        v.draw();
      } catch (err) {
        v.error = err.message;
        fatal('视图运行失败：' + err.message);
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
          (ph.paused ? ' · 已暂停' : '') : '') +
        (v.locked ? '' : ' &nbsp;·&nbsp; <span class="hint">' + (v.pointerError || '点画面锁定鼠标') + '</span>');
      var ws = document.getElementById(current === 'physics' ? 'physics-w' : 'wslider');
      if (document.activeElement !== ws) ws.value = v.cam[3];
    } else {
      hud.style.display = 'none';
    }
    requestAnimationFrame(frame);
  }

  resize();
  select('analogy');
  requestAnimationFrame(frame);
})();

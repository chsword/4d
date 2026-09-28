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
  var report = { errors: [], shaderFails: [], tabs: {} };
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
    }
    return getCtx.call(this, type, attrs);
  };

  var draws = 0, ops = 0;
  var proto = window.WebGLRenderingContext && WebGLRenderingContext.prototype;
  if (proto) {
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
      proto[k] = function () { draws++; return f.apply(this, arguments); };
    });
  }
  var c2d = CanvasRenderingContext2D.prototype;
  ['stroke', 'fill', 'fillRect', 'fillText', 'drawImage'].forEach(function (k) {
    var f = c2d[k];
    c2d[k] = function () { ops++; return f.apply(this, arguments); };
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

  window.addEventListener('load', function () {
    (async function () {
      await wait(600);
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
      for (var i = 0; i < tabs.length; i++) {
        var name = tabs[i].dataset.view;
        tabs[i].click();
        var before = draws + ops;
        await wait(900);
        var cv = document.querySelector('#stage canvas.active') ||
                 document.querySelector('canvas.active');
        var info = {
          drawCalls: (draws + ops) - before,
          canvas: cv ? (cv.id + '@' + cv.width + 'x' + cv.height) : 'NONE'
        };
        if (cv) {
          try { Object.assign(info, sample(cv)); }
          catch (e) { info.sampleError = String(e.message); }
        }
        report.tabs[name] = info;
      }
      report.tabCount = tabs.length;
      report.rafCallbacks = rafCbs;
      document.title = 'REPORT>>' + JSON.stringify(report) + '<<END';
    })();
  });
})();

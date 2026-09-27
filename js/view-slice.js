/* view-slice.js —— 手法 B：切片法（真正"住在四维世界里"的那种做法）
 *
 * 思路完全照搬《平面国》：一个二维生物看不到球，只能看到球与它所在
 * 平面的交 —— 一个会长大又缩小的圆。把维数各加一：
 *
 *   我们看不到四维物体，只能看到它与我们所在的那个三维超平面的交。
 *
 * 所以渲染管线是：
 *   1. 玩家在 4D 里有一个位置 uCam 和一组正交基 (Ax, Ay, Az, Aw)；
 *      前三个张成"我们能看见的那个 3D 世界"，Aw 指向我们看不见的方向。
 *   2. 在这个 3D 切片里做普通的 ray marching：屏幕上每个像素发一条射线，
 *      射线上的 3D 点 q 先抬回 4D：P = uCam + q.x·Ax + q.y·Ay + q.z·Az，
 *      再求 4D 的有向距离场 map(P)。
 *   3. 法线取 map 在 Ax/Ay/Az 三个方向上的差分 —— 得到的是切片内的法线，
 *      也就是切片里的居民真正会看到的明暗。
 *
 * 好处：没有任何形变，看到的是 100% 真实的局部几何（Miegakure / 4D Toys
 * 走的就是这条路）。代价：一次只看到一层，需要靠沿第四维移动来"扫"出全貌。
 */
(function (global) {
  'use strict';

  /* 一个覆盖全屏的大三角形，比四边形省一次顶点 */
  var VERT = [
    'attribute vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  /* GLSL 源码必须是纯 ASCII —— GLSL ES 规定的字符集不含中文，
     ANGLE 等实现会连注释里的非 ASCII 字符一起报错。所以着色器里的说明
     都搬到这里：

       sdBox4 / sdSphere4   四维盒子、四维球（glome）
       sdDuocylinder        双圆柱，两个圆盘的笛卡尔积，四维独有
       sdSpheritorus        球环面，一根管子沿球面扫出来
       sdTiger              两个圆环的"积"，切片会分裂成两个独立的环

       lift(q)              切片坐标(3D) -> 四维世界坐标
                            P = uCam + q.x*uAx + q.y*uAy + q.z*uAz
       sliceNormal(q)       map 在 uAx/uAy/uAz 三向上的差分 = 切片内的法线，
                            也就是切片里的居民真正会看到的明暗
       wExtent(p)           沿看不见的 uAw 方向探一探：这块表面背后的物体
                            在第四维上有多厚。0 = 薄如纸(马上要消失了)
       uXRay                射线在第四维上左右各偏 1.1 再测一次距离，
                            把"隔壁切片里有东西"画成蓝雾
       material id 1 号     地板棋盘格，第三个因子取 floor(w) ——
                            沿第四维移动时格子翻色，是"我真的动了"的反馈
       L4 投影到切片         四维方向光只有落在切片里的那个分量才照得到我们
  */
  var FRAG = [
    'precision highp float;',
    '',
    'uniform vec2  uRes;',
    'uniform vec4  uCam;',
    'uniform vec4  uAx, uAy, uAz, uAw;',
    'uniform float uFocal;',
    'uniform float uWTint;',
    'uniform float uXRay;',
    'uniform float uSelected;',
    '/* SCENE_UNIFORMS */',
    '',
    'const float FAR = 70.0;',
    '',
    Scene4.library,
    '',
    '// no vector ternary: some old GLSL drivers reject "c ? vecA : vecB"',
    'vec2 opU(vec2 a, vec2 b){ if (a.x < b.x) return a; return b; }',
    '',
    '/* SCENE_MAP */',
    '',
    'vec4 lift(vec3 q){ return uCam + q.x * uAx + q.y * uAy + q.z * uAz; }',
    '',
    'vec3 sliceNormal(vec3 q){',
    '  float e = 0.0022;',
    '  vec4 p = lift(q);',
    '  return normalize(vec3(',
    '    map(p + e * uAx).x - map(p - e * uAx).x,',
    '    map(p + e * uAy).x - map(p - e * uAy).x,',
    '    map(p + e * uAz).x - map(p - e * uAz).x));',
    '}',
    '',
    '// how far does this object extend along the invisible direction?',
    '// 0 = paper-thin (about to vanish), 1 = thicker than we probed',
    'float wExtent(vec4 p){',
    '  float span = 0.0;',
    '  for (int i = 1; i <= 10; i++) {',
    '    float d = float(i) * 0.3;',
    '    if (map(p + d * uAw).x < 0.0) span += 1.0;',
    '    if (map(p - d * uAw).x < 0.0) span += 1.0;',
    '  }',
    '  return span / 20.0;',
    '}',
    '',
    'vec3 material(float id, vec4 p){',
    '  if (id < 1.5) {',
    '    float c  = mod(floor(p.x) + floor(p.z), 2.0);',
    '    float cw = mod(floor(p.w), 2.0);',
    '    vec3 a = mix(vec3(0.16, 0.18, 0.23), vec3(0.30, 0.33, 0.40), c);',
    '    return mix(a, a * vec3(1.15, 0.95, 0.85), cw * 0.55);',
    '  }',
    '  if (id < 2.5) return vec3(0.95, 0.35, 0.35);',
    '  if (id < 3.5) return vec3(0.35, 0.72, 0.98);',
    '  if (id < 4.5) return vec3(0.98, 0.78, 0.30);',
    '  if (id < 5.5) return vec3(0.55, 0.95, 0.55);',
    '  if (id < 6.5) return vec3(0.82, 0.52, 0.98);',
    '  if (id < 7.5) return vec3(0.55, 0.58, 0.66);',
    '  if (id < 8.5) return vec3(1.00, 0.85, 0.20);',
    '  return vec3(0.75, 0.78, 0.82);',
    '}',
    '',
    'float softShadow(vec3 q, vec3 L){',
    '  float t = 0.08, res = 1.0;',
    '  for (int i = 0; i < 28; i++) {',
    '    float h = map(lift(q + L * t)).x;',
    '    res = min(res, 9.0 * h / t);',
    '    t += clamp(h, 0.08, 1.2);',
    '    if (res < 0.02 || t > 16.0) break;',
    '  }',
    '  return clamp(res, 0.0, 1.0);',
    '}',
    '',
    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',
    '  vec3 rd = normalize(vec3(uv, uFocal));',
    '',
    '  float t = 0.0, id = 0.0, ghost = 0.0;',
    '  bool hit = false;',
    '  for (int i = 0; i < 128; i++) {',
    '    vec4 p = lift(rd * t);',
    '    vec2 h = map(p);',
    '    if (uXRay > 0.5) {',
    '      float o = min(map(p + 1.1 * uAw).x, map(p - 1.1 * uAw).x);',
    '      ghost += (1.0 - smoothstep(0.0, 0.5, o)) * 0.014;',
    '    }',
    '    if (h.x < 0.0018 * max(t, 1.0)) { hit = true; id = h.y; break; }',
    '    t += h.x * 0.92;',
    '    if (t > FAR) break;',
    '  }',
    '',
    '  vec3 sky = mix(vec3(0.035, 0.045, 0.07), vec3(0.10, 0.13, 0.20), 0.5 + 0.5 * rd.y);',
    '  vec3 col = sky;',
    '',
    '  if (hit) {',
    '    vec3 q = rd * t;',
    '    vec4 p4 = lift(q);',
    '    vec3 n = sliceNormal(q);',
    '    vec4 L4 = normalize(vec4(0.45, 0.85, 0.30, 0.10));',
    '    vec3 L = normalize(vec3(dot(L4, uAx), dot(L4, uAy), dot(L4, uAz)));',
    '    vec3 base = material(id, p4);',
    '',
    '    float dif  = clamp(dot(n, L), 0.0, 1.0);',
    '    float sh   = softShadow(q + n * 0.02, L);',
    '    float amb  = 0.35 + 0.35 * n.y;',
    '    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);',
    '',
    '    col  = base * (amb * vec3(0.30, 0.36, 0.48) + dif * sh * vec3(1.35, 1.24, 1.05));',
    '    col += fres * 0.25 * vec3(0.6, 0.8, 1.0);',
    '    if (abs(id - uSelected) < 0.1) col += (0.04 + fres * 0.3) * vec3(0.2, 0.9, 1.0);',
    '',
    '    if (uWTint > 0.5 && id > 1.5) {',
    '      vec4 inside = p4 - 0.03 * (n.x * uAx + n.y * uAy + n.z * uAz);',
    '      float ext = wExtent(inside);',
    '      col = mix(col * vec3(1.6, 0.45, 0.45), col, smoothstep(0.02, 0.45, ext));',
    '    }',
    '',
    '    col = mix(sky, col, exp(-t * t * 0.0009));',
    '  }',
    '',
    '  if (uXRay > 0.5) col += vec3(0.16, 0.30, 0.55) * min(ghost, 0.9);',
    '',
    '  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }

  function SliceView(canvas, scene) {
    scene = scene || Scene4.gallery;
    this.scene = scene;
    this.cameraRadius = 0.35;
    this.collisionScene = scene.collision === true ? scene : null;
    if (this.collisionScene && typeof scene.move !== 'function') throw new TypeError('Collision scene needs move()');
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: false, alpha: false })
           || canvas.getContext('experimental-webgl');
    if (!this.gl) { this.error = 'WebGL 不可用'; return; }
    var gl = this.gl;

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    var frag = FRAG.replace('/* SCENE_UNIFORMS */', scene.uniforms || '')
      .replace('/* SCENE_MAP */', scene.map || Scene4.gallery.map);
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    this.prog = prog;

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    ['uRes', 'uCam', 'uAx', 'uAy', 'uAz', 'uAw', 'uFocal', 'uWTint', 'uXRay', 'uSelected']
      .forEach(function (n) { this.u[n] = gl.getUniformLocation(prog, n); }, this);

    // 玩家状态
    this.cam = [0, 0.4, 0, 0];        // 四维位置
    this.yaw = 0;
    this.pitch = 0;
    this.a_xw = 0;                    // xw 平面转角（把"右"转向第四维）
    this.a_zw = 0;                    // zw 平面转角（把"前"转向第四维）
    this.focal = 1.5;
    this.wTint = true;
    this.xray = false;
    this.selectedMaterial = 0;
    this.keys = {};
    this.locked = false;
    this._bind();
  }

  SliceView.prototype._bind = function () {
    var self = this, cv = this.canvas;
    cv.addEventListener('click', function () {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (!self.locked && cv.requestPointerLock) {
        var request = cv.requestPointerLock();
        if (request && request.catch) request.catch(function (err) {
          self.pointerError = '鼠标锁定失败，请重新点击画面';
          console.error(err);
        });
      }
    });
    document.addEventListener('pointerlockchange', function () {
      self.locked = (document.pointerLockElement === cv);
      if (self.locked) self.pointerError = '';
    });
    cv.addEventListener('pointerlockerror', function () {
      self.pointerError = '鼠标锁定失败，请重新点击画面';
      console.error(self.pointerError);
    });
    document.addEventListener('mousemove', function (e) {
      if (!self.locked) return;
      self.yaw -= e.movementX * 0.0025;
      self.pitch -= e.movementY * 0.0025;
      self.pitch = Math.max(-1.45, Math.min(1.45, self.pitch));
    });
  };

  /* 玩家的四维基。列 = (右, 上, 前, 第四维)。
     基向量 forward 取 -e_z（右手系里相机朝 -z 看）。
     世界层面的 xw / zw 旋转放在最外层：它们不动 e_y，
     所以地板在切片里永远还是一个正常的水平面，人不会迷失。 */
  SliceView.prototype.frame = function () {
    var B = [1, 0, 0, 0,
             0, 1, 0, 0,
             0, 0, -1, 0,
             0, 0, 0, 1];
    var R = M4.compose([
      M4.rotation('zw', this.a_zw),
      M4.rotation('xw', this.a_xw),
      M4.rotation('xz', this.yaw),
      M4.rotation('yz', this.pitch)
    ]);
    return M4.orthonormalize(M4.mul(R, B));
  };

  SliceView.prototype.step = function (dt) {
    var k = this.keys, F = this.frame();
    var right = M4.col(F, 0), fwd = M4.col(F, 2);
    var speed = (k['shiftleft'] || k['shiftright'] ? 14 : 5.5) * dt;
    var move = [0, 0, 0, 0];

    // 水平移动：把前 / 右向量的 y 分量去掉，走起来像个人而不是飞行器
    var fh = [fwd[0], 0, fwd[2], fwd[3]], rh = [right[0], 0, right[2], right[3]];
    fh = M4.normalize(fh); rh = M4.normalize(rh);

    if (k['keyw']) move = M4.add(move, fh);
    if (k['keys']) move = M4.sub(move, fh);
    if (k['keyd']) move = M4.add(move, rh);
    if (k['keya']) move = M4.sub(move, rh);
    if (k['space']) move = M4.add(move, [0, 1, 0, 0]);
    if (k['keyc']) move = M4.sub(move, [0, 1, 0, 0]);
    // Q / E：沿世界的第四维轴平移。切片保持平行，只是滑过去 ——
    // 对应《平面国》里那个"把平面上下挪一点"的动作。
    if (k['keyq']) move = M4.sub(move, [0, 0, 0, 1]);
    if (k['keye']) move = M4.add(move, [0, 0, 0, 1]);

    if (M4.len(move) > 1e-6) {
      move = M4.scale(M4.normalize(move), speed);
      this.moveCamera(move);
    }
    if (!this.collisionScene && this.cam[1] < -1.1) this.cam[1] = -1.1;

    // Z / X、R / F：真正的四维转身 —— 把看不见的方向旋进视野
    var rs = 0.9 * dt;
    if (k['keyz']) this.a_zw -= rs;
    if (k['keyx']) this.a_zw += rs;
    if (k['keyr']) this.a_xw -= rs;
    if (k['keyf']) this.a_xw += rs;
  };

  SliceView.prototype.moveCamera = function (delta) {
    this.cam = this.collisionScene
      ? this.collisionScene.move(this.cam, delta, this.cameraRadius) : M4.add(this.cam, delta);
  };

  SliceView.prototype.setW = function (w) {
    this.moveCamera([0, 0, 0, w - this.cam[3]]);
  };

  SliceView.prototype.resetW = function () {
    this.setW(0); this.a_xw = 0; this.a_zw = 0;
  };

  SliceView.prototype.draw = function () {
    var gl = this.gl, cv = this.canvas;
    if (!gl) return;
    gl.useProgram(this.prog);
    var F = this.frame();
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(this.u.uRes, cv.width, cv.height);
    gl.uniform4fv(this.u.uCam, this.cam);
    gl.uniform4fv(this.u.uAx, M4.col(F, 0));
    gl.uniform4fv(this.u.uAy, M4.col(F, 1));
    gl.uniform4fv(this.u.uAz, M4.col(F, 2));
    gl.uniform4fv(this.u.uAw, M4.col(F, 3));
    gl.uniform1f(this.u.uFocal, this.focal);
    gl.uniform1f(this.u.uWTint, this.wTint ? 1 : 0);
    gl.uniform1f(this.u.uXRay, this.xray ? 1 : 0);
    gl.uniform1f(this.u.uSelected, this.selectedMaterial);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  global.SliceView = SliceView;
})(window);

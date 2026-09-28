/* view-physics.js —— 动态刚体只替换切片视图的场景 SDF。
 * 沿用 SliceView 的四维相机、光照和地板棋盘格，不创建另一套投影约定。
 * 着色器里的注释和字符串仍必须是 ASCII，中文说明只放在 JS 中。
 */
(function (global) {
  'use strict';

  function PhysicsView(canvas) {
    var gl = canvas.getContext('webgl', { antialias: false, alpha: false })
      || canvas.getContext('experimental-webgl');
    if (!gl) { this.error = 'WebGL 不可用'; return; }
    // 每个刚体占 7 个 uniform 向量槽，为共享相机和场景参数另留 12 槽。
    this.maxBodies = Math.min(8, Math.floor((gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) - 12) / 7));
    if (this.maxBodies < 1) { this.error = 'WebGL fragment uniform 容量不足'; return; }
    var N = this.maxBodies;
    SliceView.call(this, canvas, {
      collision: false,
      uniforms: [
        'uniform mat4 uInvR[' + N + '];',
        'uniform vec4 uBodyPos[' + N + '];',
        'uniform vec4 uSize[' + N + '];',
        'uniform float uShape[' + N + '];',
        'uniform int uCount;',
        'uniform float uFloor;'
      ].join('\n'),
      map: [
        'vec2 map(vec4 p){',
        '  vec2 res = vec2(p.y - uFloor, 1.0);',
        '  for (int i = 0; i < ' + N + '; i++) {',
        '    if (i >= uCount) break;',
        '    vec4 offset = p - uBodyPos[i];',
        '    float bound = length(uSize[i]);',
        '    if (uShape[i] > 0.5) bound = uSize[i].x;',
        '    if (length(offset) - bound > res.x) continue;',
        '    vec4 local = uInvR[i] * offset;',
        '    float d = sdBox4(local, uSize[i]);',
        '    if (uShape[i] > 0.5) d = sdSphere4(local, uSize[i].x);',
        '    res = opU(res, vec2(d, float(i) + 2.0));',
        '  }',
        '  return res;',
        '}'
      ].join('\n')
    });
    if (this.error) return;
    this.world = new Physics4.World4();
    this.timeStep = 1 / 240;
    this.accumulator = 0;
    this.paused = false;
    this._rPressedAt = null;
    this._rTurning = false;
    this.rotations = new Float32Array(N * 16);
    this.positions = new Float32Array(N * 4);
    this.sizes = new Float32Array(N * 4);
    this.shapes = new Float32Array(N);
    ['uInvR', 'uBodyPos', 'uSize', 'uShape'].forEach(function (name) {
      this.u[name] = gl.getUniformLocation(this.prog, name + '[0]');
    }, this);
    ['uCount', 'uFloor'].forEach(function (name) {
      this.u[name] = gl.getUniformLocation(this.prog, name);
    }, this);
    this.resetScene();
  }

  PhysicsView.prototype = Object.create(SliceView.prototype);
  PhysicsView.prototype.constructor = PhysicsView;

  PhysicsView.prototype.resetScene = function () {
    this.accumulator = 0;
    this.spawnCount = 0;
    this.keys = {};
    this._rPressedAt = null;
    this._rTurning = false;
    this.world._collisionContacts = [];
    this.world._solverResult = null;
    this.world.bodies = [
      new RigidBody4({
        halfSize: [0.55, 0.8, 0.45, 1.05], position: [-2, 1.2, -8, 0],
        velocity: [1.4, 0, 0, 0.1],
        orientation: M4.compose([M4.rotation('xy', 0.3), M4.rotation('xw', 0.5)]),
        angularVelocity: [0.7, -0.4, 1.1, 0.5, 0.9, -0.6]
      }),
      new RigidBody4({
        shape: 'glome', radius: 0.8, position: [0, 2.1, -8, 0.1],
        velocity: [0, -0.2, 0, -0.1], angularVelocity: [0.2, 0, 0.5, 0.4, 0.6, 0]
      }),
      new RigidBody4({
        halfSize: [0.9, 0.45, 0.65, 0.55], position: [2, 1.8, -8, -0.1],
        velocity: [-1.4, 0, 0, 0],
        orientation: M4.rotation('yw', 0.6), angularVelocity: [-0.6, 0.8, 0.3, 0.7, -1, 0.4]
      }),
      new RigidBody4({
        halfSize: [0.65, 0.8, 0.5, 0.9], position: [0, 4, -8, 0.2],
        angularVelocity: [0.5, 0.3, -0.8, 0.4, 0.7, 1]
      }),
      new RigidBody4({
        halfSize: [0.8, 0.5, 0.8, 0.9], position: [-0.8, -1, -8, 0]
      }),
      new RigidBody4({
        halfSize: [0.8, 0.5, 0.8, 0.9], position: [0.8, -1, -8, 0]
      })
    ].slice(0, this.maxBodies);
    this.error = null;
  };

  PhysicsView.prototype.resetCamera = function () {
    this.cam = [0, 0.4, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.resetW();
  };

  PhysicsView.prototype.spawn = function () {
    var fwd = M4.col(this.frame(), 2), index = this.spawnCount++;
    var position = M4.add(this.cam, M4.scale(fwd, 1.8));
    position[1] = Math.max(position[1] + 0.35, 0);
    var body = new RigidBody4({
      shape: index % 2 ? 'glome' : 'box4',
      halfSize: [0.45, 0.65, 0.55, 0.8], radius: 0.65,
      position: position, velocity: M4.add(M4.scale(fwd, 5), [0, 3, 0, 0]),
      orientation: M4.compose([M4.rotation('zw', this.a_zw), M4.rotation('xw', this.a_xw),
        M4.rotation('xz', this.yaw), M4.rotation('xy', 0.4)]),
      angularVelocity: [0.8, -0.5, 1.2, 0.4, 0.7, -0.9]
    });
    if (this.world.bodies.length === this.maxBodies) this.world.bodies.shift();
    this.world.bodies.push(body);
  };

  PhysicsView.prototype.clearInput = function () {
    this.keys = {};
    this._rPressedAt = null;
    this._rTurning = false;
    this.accumulator = 0;
  };

  PhysicsView.prototype.keyDown = function (e) {
    var key = e.code.toLowerCase();
    if (key === 'space') {
      if (!e.repeat) this.spawn();
      return;
    }
    if (key === 'keyr' && !this.keys[key]) {
      this._rPressedAt = performance.now();
      this._rTurning = false;
    }
    this.keys[key] = true;
  };

  PhysicsView.prototype.keyUp = function (e) {
    var key = e.code.toLowerCase();
    // 延迟转身，短按重置；避免按一次 R 既清场又扭动相机。
    if (key === 'keyr' && this._rPressedAt !== null) {
      if (!this._rTurning && performance.now() - this._rPressedAt < 250) this.resetScene();
      this._rPressedAt = null;
      this._rTurning = false;
    }
    this.keys[key] = false;
  };

  PhysicsView.prototype.step = function (dt) {
    var keys = this.keys;
    this._rTurning = keys.keyr && this._rPressedAt !== null && performance.now() - this._rPressedAt >= 250;
    // Space 留给投掷；V/C 保留升降，控制面板获得焦点时由 app 停止截获键盘。
    this.keys = Object.assign({}, keys, { space: keys.keyv, keyr: this._rTurning });
    SliceView.prototype.step.call(this, dt);
    this.keys = keys;
    if (this.paused) { this.accumulator = 0; return; }
    // 固定物理步长不随帧率变化；隐藏页签和窗口失焦时不积攒补算债务。
    this.accumulator += Math.min(dt, 0.05);
    while (this.accumulator + 1e-12 >= this.timeStep) {
      this.world.step(this.timeStep);
      this.accumulator = Math.max(0, this.accumulator - this.timeStep);
    }
  };

  PhysicsView.prototype.draw = function () {
    var gl = this.gl, bodies = this.world.bodies;
    gl.useProgram(this.prog);
    for (var i = 0; i < bodies.length; i++) {
      var body = bodies[i];
      /* R 为行主序，而 uniformMatrix4fv 只能按列主序上传。
         直接上传 R 的数组，shader 得到的恰是 Rᵀ = Rinv，不能再转置一次。 */
      this.rotations.set(body.orientation, i * 16);
      this.positions.set(body.position, i * 4);
      this.sizes.set(body.shape === 'glome'
        ? [body.radius, body.radius, body.radius, body.radius] : body.halfSize, i * 4);
      this.shapes[i] = body.shape === 'glome' ? 1 : 0;
    }
    gl.uniformMatrix4fv(this.u.uInvR, false, this.rotations);
    gl.uniform4fv(this.u.uBodyPos, this.positions);
    gl.uniform4fv(this.u.uSize, this.sizes);
    gl.uniform1fv(this.u.uShape, this.shapes);
    gl.uniform1i(this.u.uCount, bodies.length);
    gl.uniform1f(this.u.uFloor, this.world.floorY);
    SliceView.prototype.draw.call(this);
  };

  global.PhysicsView = PhysicsView;
})(window);

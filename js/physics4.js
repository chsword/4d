/* physics4.js —— 四维刚体：角速度、力矩、角动量都属于 bivector 空间。
 *
 * 顺序与 M4.PLANES 一致：[xy, xz, xw, yz, yw, zw]。
 * 正 xy 角速度把 +x 转向 +y，因此矩阵上三角是分量的负值；
 * 这个符号保证 <r∧F, ω> = F·(Ωr)，冲量做功与转动能使用同一约定。
 * 位置、速度、力、外力矩用世界系；姿态 R 把本体系送到世界系，
 * angularVelocity 和 6×6 惯性矩阵用本体系。所有矩阵都是行主序。
 */
(function (global) {
  'use strict';

  var PLANES = M4.PLANES.slice();
  var PAIRS = PLANES.map(function (p) { return [M4.AXIS[p[0]], M4.AXIS[p[1]]]; });
  var ZERO6 = [0, 0, 0, 0, 0, 0];
  var NORMAL = [0, 1, 0, 0];

  function finiteArray(a, n, name) {
    if (!a || a.length !== n || !Array.prototype.every.call(a, Number.isFinite)) {
      throw new Error(name + ' 必须包含 ' + n + ' 个有限数');
    }
  }

  function positive(x, name) {
    if (!Number.isFinite(x) || x <= 0) throw new Error(name + ' 必须为有限正数');
  }

  function toMatrix(b) {
    var m = new Array(16).fill(0);
    for (var k = 0; k < 6; k++) {
      var i = PAIRS[k][0], j = PAIRS[k][1];
      m[i * 4 + j] = -b[k];
      m[j * 4 + i] = b[k];
    }
    return m;
  }

  function fromMatrix(m) {
    return PAIRS.map(function (p) { return (m[p[1] * 4 + p[0]] - m[p[0] * 4 + p[1]]) * 0.5; });
  }

  function wedge(a, b) {
    return PAIRS.map(function (p) { return a[p[0]] * b[p[1]] - a[p[1]] * b[p[0]]; });
  }

  function commutator(a, b) {
    var A = toMatrix(a), B = toMatrix(b), AB = M4.mul(A, B), BA = M4.mul(B, A);
    return fromMatrix(AB.map(function (x, i) { return x - BA[i]; }));
  }

  function act(b, v) { return M4.mulVec(toMatrix(b), v); }

  function transform(b, R) {
    return fromMatrix(M4.mul(M4.mul(R, toMatrix(b)), M4.transpose(R)));
  }

  // M4.dot 只处理四个分量，不能拿来计算 bivector 的内积。
  function dot6(a, b) {
    var s = 0;
    for (var i = 0; i < 6; i++) s += a[i] * b[i];
    return s;
  }

  function mul6(m, v) {
    var out = new Array(6).fill(0);
    for (var i = 0; i < 6; i++) {
      for (var j = 0; j < 6; j++) out[i] += m[i * 6 + j] * v[j];
    }
    return out;
  }

  function inverseInertia(m) {
    finiteArray(m, 36, '惯性张量');
    var L = new Array(36).fill(0), out = new Array(36).fill(0), i, j, k;
    // Cholesky 同时验证正定性，拒绝不物理的输入，而不是让 NaN 进入场景。
    for (i = 0; i < 6; i++) {
      for (j = 0; j <= i; j++) {
        if (Math.abs(m[i * 6 + j] - m[j * 6 + i]) > 1e-12 * Math.max(1, Math.abs(m[i * 6 + j]))) {
          throw new Error('惯性张量必须对称');
        }
        var s = m[i * 6 + j];
        for (k = 0; k < j; k++) s -= L[i * 6 + k] * L[j * 6 + k];
        if (i === j) {
          if (s <= 0) throw new Error('惯性张量必须正定');
          L[i * 6 + j] = Math.sqrt(s);
        } else {
          L[i * 6 + j] = s / L[j * 6 + j];
        }
      }
    }
    for (var c = 0; c < 6; c++) {
      var y = new Array(6).fill(0), x = new Array(6).fill(0);
      for (i = 0; i < 6; i++) {
        s = i === c ? 1 : 0;
        for (j = 0; j < i; j++) s -= L[i * 6 + j] * y[j];
        y[i] = s / L[i * 6 + i];
      }
      for (i = 5; i >= 0; i--) {
        s = y[i];
        for (j = i + 1; j < 6; j++) s -= L[j * 6 + i] * x[j];
        x[i] = s / L[i * 6 + i];
        out[i * 6 + c] = x[i];
      }
    }
    return out;
  }

  function inertiaBox4(mass, halfSize) {
    positive(mass, '质量');
    finiteArray(halfSize, 4, '盒子半边长');
    if (halfSize.some(function (h) { return h < 0; })) throw new Error('半边长不能为负');
    /* 均匀盒子 <x_i²> = h_i²/3，交叉二阶矩为零。
       T = 1/2 ∫|Ωx|² dm = 1/2 Σ_(i<j) m(h_i²+h_j²)/3 · ω_ij²。
       因而主平面基底的惯性是 6×6 对角阵；允许 h_w=0 来检验三维退化。 */
    var I = new Array(36).fill(0);
    PAIRS.forEach(function (p, k) {
      I[k * 6 + k] = mass * (halfSize[p[0]] * halfSize[p[0]] + halfSize[p[1]] * halfSize[p[1]]) / 3;
    });
    return I;
  }

  function inertiaGlome(mass, radius) {
    positive(mass, '质量');
    positive(radius, '超球半径');
    /* 均匀实心 n 维球 <|x|²> = n r²/(n+2)，每个坐标 <x_i²> = r²/(n+2)。
       每个旋转平面包含两个坐标：n=4 时 I_ij = 2mr²/6 = mr²/3，
       不是三维实心球的 2mr²/5，也不是只在 S³ 表面分布质量的球壳。 */
    var I = new Array(36).fill(0);
    for (var k = 0; k < 6; k++) I[k * 6 + k] = mass * radius * radius / 3;
    return I;
  }

  function RigidBody4(options) {
    var o = options || {};
    this.shape = o.shape === undefined ? 'box4' : o.shape;
    if (this.shape !== 'box4' && this.shape !== 'glome') throw new Error('未知刚体形状：' + this.shape);
    this.mass = o.mass === undefined ? 1 : o.mass;
    positive(this.mass, '质量');
    this.invMass = 1 / this.mass;
    this.halfSize = (o.halfSize || [0.6, 0.6, 0.6, 0.6]).slice();
    this.radius = o.radius === undefined ? 0.65 : o.radius;
    var shapeInertia = this.shape === 'box4'
      ? inertiaBox4(this.mass, this.halfSize) : inertiaGlome(this.mass, this.radius);
    this.inertia = (o.inertia || shapeInertia).slice();
    this.invInertia = inverseInertia(this.inertia);
    this.position = (o.position || [0, 0, 0, 0]).slice();
    this.velocity = (o.velocity || [0, 0, 0, 0]).slice();
    this.orientation = (o.orientation || M4.ident()).slice();
    this.angularVelocity = (o.angularVelocity || ZERO6).slice();
    finiteArray(this.position, 4, '位置');
    finiteArray(this.velocity, 4, '速度');
    finiteArray(this.orientation, 16, '姿态');
    finiteArray(this.angularVelocity, 6, '角速度');
    var gram = M4.mul(M4.transpose(this.orientation), this.orientation);
    if (gram.some(function (x, i) { return Math.abs(x - (i % 5 === 0 ? 1 : 0)) > 1e-8; })) {
      throw new Error('姿态必须为正交矩阵');
    }
    this.force = [0, 0, 0, 0];
    this.torque = ZERO6.slice();
  }

  RigidBody4.prototype.worldAngularMomentum = function () {
    return transform(mul6(this.inertia, this.angularVelocity), this.orientation);
  };

  RigidBody4.prototype.kineticEnergy = function () {
    return 0.5 * this.mass * M4.dot(this.velocity, this.velocity) +
      0.5 * dot6(this.angularVelocity, mul6(this.inertia, this.angularVelocity));
  };

  RigidBody4.prototype.applyForce = function (force, point) {
    finiteArray(force, 4, '力');
    if (point !== undefined) finiteArray(point, 4, '力的作用点');
    this.force = M4.add(this.force, force);
    if (point !== undefined) {
      var t = wedge(M4.sub(point, this.position), force);
      for (var k = 0; k < 6; k++) this.torque[k] += t[k];
    }
  };

  RigidBody4.prototype.applyTorque = function (torque) {
    finiteArray(torque, 6, '世界系力矩');
    for (var k = 0; k < 6; k++) this.torque[k] += torque[k];
  };

  RigidBody4.prototype.inverseInertiaWorld = function (torque) {
    var R = this.orientation;
    return transform(mul6(this.invInertia, transform(torque, M4.transpose(R))), R);
  };

  RigidBody4.prototype.pointVelocity = function (r) {
    return M4.add(this.velocity, act(transform(this.angularVelocity, this.orientation), r));
  };

  // r 是相对质心的世界系力臂，不是绝对接触位置。
  RigidBody4.prototype.applyImpulse = function (impulse, r) {
    finiteArray(impulse, 4, '冲量');
    finiteArray(r, 4, '力臂');
    this.velocity = M4.add(this.velocity, M4.scale(impulse, this.invMass));
    var Rt = M4.transpose(this.orientation);
    var dw = mul6(this.invInertia, wedge(M4.mulVec(Rt, r), M4.mulVec(Rt, impulse)));
    for (var k = 0; k < 6; k++) this.angularVelocity[k] += dw[k];
  };

  function shifted(R, dR, h) {
    return R.map(function (x, i) { return x + dR[i] * h; });
  }

  RigidBody4.prototype.step = function (dt, gravity, stepBudget) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('时间步长必须为有限非负数');
    if (gravity === undefined) gravity = 9.81;
    if (!Number.isFinite(gravity) || gravity < 0) throw new Error('重力必须为有限非负数');
    if (dt === 0) return;
    var L = this.worldAngularMomentum(), k;
    for (k = 0; k < 6; k++) L[k] += dt * this.torque[k];
    for (k = 0; k < 4; k++) {
      this.velocity[k] += dt * (this.force[k] * this.invMass - (k === 1 ? gravity : 0));
      this.position[k] += dt * this.velocity[k];
    }

    /* 半隐式 kick-drift：先更新世界系动量，再积分姿态。
       直接用 Euler 更新 ω 会持续制造转动能，缩小步长只能推迟爆炸。
       改用 R'=RΩ、L_body=RᵀL_world R 的 RK4，末端正交化后重新求 ω。
       对 L_body 求导正好得到 Iω' = τ - [Ω,L_body]，不是省略陀螺项。
       世界 L 的保持是代数恒等式，能量误差由四阶姿态积分控制，
       没有按初始能量缩放速度这样的非物理补丁。 */
    var invI = this.invInertia, Lmat = toMatrix(L);
    function derivative(R) {
      var lb = fromMatrix(M4.mul(M4.mul(M4.transpose(R), Lmat), R));
      return M4.mul(R, toMatrix(mul6(invI, lb)));
    }
    // 限制单步转角，让投掷时较大的角速度也落在 RK4 的稳定区间。
    var omega = mul6(invI, transform(L, M4.transpose(this.orientation)));
    var count = Math.max(1, Math.ceil(dt * Math.sqrt(dot6(omega, omega)) / 0.05));
    var h = dt / count;
    for (var s = 0; s < count; s++) {
      if (stepBudget) stepBudget.spend(1);
      var R = this.orientation;
      var a = derivative(R), b = derivative(shifted(R, a, h / 2));
      var c = derivative(shifted(R, b, h / 2)), d = derivative(shifted(R, c, h));
      this.orientation = M4.orthonormalize(R.map(function (x, i) {
        return x + h * (a[i] + 2 * b[i] + 2 * c[i] + d[i]) / 6;
      }));
    }
    this.angularVelocity = mul6(invI, transform(L, M4.transpose(this.orientation)));
    this.force = [0, 0, 0, 0];
    this.torque = ZERO6.slice();
  };

  function effectiveMass(body, r, direction) {
    return body.invMass + M4.dot(direction, act(body.inverseInertiaWorld(wedge(r, direction)), r));
  }

  function floorContacts(body, floorY) {
    if (floorY === undefined) floorY = -1.5;
    var contacts = [], deepest = 0, separation = Infinity, r, depth;
    if (body.shape === 'glome') {
      r = [0, -body.radius, 0, 0];
      depth = floorY - body.position[1] + body.radius;
      if (depth >= -1e-7) contacts.push({ r: r, depth: depth });
      deepest = Math.max(0, depth);
      separation = -depth;
    } else {
      for (var mask = 0; mask < 16; mask++) {
        var v = body.halfSize.map(function (h, i) { return (mask & (1 << i)) ? h : -h; });
        r = M4.mulVec(body.orientation, v);
        depth = floorY - body.position[1] - r[1];
        if (depth >= -1e-7) contacts.push({ r: r, depth: depth });
        deepest = Math.max(deepest, depth);
        separation = Math.min(separation, -depth);
      }
    }
    return { contacts: contacts, depth: deepest, separation: separation };
  }

  function collideFloor(body, options) {
    var o = options || {}, floorY = o.floorY === undefined ? -1.5 : o.floorY;
    var restitution = o.restitution === undefined ? 0.45 : o.restitution;
    var friction = o.friction === undefined ? 0.6 : o.friction;
    if (!Number.isFinite(floorY) || !Number.isFinite(restitution) || restitution < 0 || restitution > 1 ||
        !Number.isFinite(friction) || friction < 0) throw new Error('地板或碰撞参数无效');
    var hit = floorContacts(body, floorY), contacts = hit.contacts;
    if (!contacts.length) return false;
    // 位置修正不掺入速度冲量，避免把穿透误差变成一次人为弹射。
    body.position[1] += hit.depth;
    /* 最深点决定投影距离，但平面接触必须保留共面的其它顶点：
       只解一个角点会给平放的盒子凭空制造翻滚。
       反弹逐点处理，每次冲量不增加动能；支撑另用累计冲量迭代，
       允许撤回前一次过量的支撑，否则平放盒子也会永远抖动。
       低速不反弹，避免重力的每次 kick 都触发微小弹跳。 */
    contacts.forEach(function (contact) {
      contact.body = body;
      var r = contact.r, vn = body.pointVelocity(r)[1];
      contact.normalMass = effectiveMass(body, r, NORMAL);
      contact.normalImpulse = 0;
      contact.tangentImpulse = [0, 0, 0, 0];
      if (restitution > 0 && vn < -0.5) {
        var jn = -(1 + restitution) * vn / contact.normalMass;
        body.applyImpulse(M4.scale(NORMAL, jn), r);
        var vt = body.pointVelocity(r);
        vt[1] = 0;
        var speed = M4.len(vt);
        if (speed > 1e-10 && friction > 0) {
          var tangent = M4.scale(vt, 1 / speed);
          body.applyImpulse(M4.scale(tangent,
            -Math.min(friction * jn, speed / effectiveMass(body, r, tangent))), r);
        }
      }
    });
    solveContacts(contacts, friction, undefined, o._stepBudget);
    return true;
  }

  function pointMap(body, r) {
    var R = body.orientation, local = M4.mulVec(M4.transpose(R), r);
    var J = new Array(24), response = new Array(24);
    for (var axis = 0; axis < 4; axis++) {
      PAIRS.forEach(function (pair, k) {
        J[axis * 6 + k] = -R[axis * 4 + pair[0]] * local[pair[1]] +
          R[axis * 4 + pair[1]] * local[pair[0]];
      });
    }
    for (var k = 0; k < 6; k++) for (axis = 0; axis < 4; axis++) {
      var sum = 0;
      for (var j = 0; j < 6; j++) sum += body.invInertia[k * 6 + j] * J[axis * 6 + j];
      response[k * 4 + axis] = sum;
    }
    return { body: body, orientation: R, J: J, response: response };
  }

  function mappedVelocity(map) {
    var v = map.body.velocity.slice(), omega = map.body.angularVelocity, J = map.J;
    for (var i = 0; i < 4; i++) {
      var j = i * 6;
      v[i] = v[i] + J[j] * omega[0] + J[j + 1] * omega[1] + J[j + 2] * omega[2] +
        J[j + 3] * omega[3] + J[j + 4] * omega[4] + J[j + 5] * omega[5];
    }
    return v;
  }

  function contactVelocity(contact) {
    var maps = contact._solverPoints, valid = !!maps;
    if (maps) for (var i = 0; i < maps.length; i++) {
      if (maps[i].orientation !== maps[i].body.orientation) valid = false;
    }
    if (valid) {
      var velocity = mappedVelocity(maps[0]);
      return maps.length === 2 ? M4.sub(velocity, mappedVelocity(maps[1])) : velocity;
    }
    var v = contact.body.pointVelocity(contact.r);
    return contact.other ? M4.sub(v, contact.other.pointVelocity(contact.rOther)) : v;
  }

  function contactImpulse(contact, impulse) {
    if (contact._solverPoints) {
      for (var index = 0; index < contact._solverPoints.length; index++) {
        var map = contact._solverPoints[index];
        var body = map.body, sign = index ? -1 : 1;
        for (var i = 0; i < 4; i++) body.velocity[i] += sign * impulse[i] * body.invMass;
        for (var k = 0; k < 6; k++) {
          var j = k * 4, response = map.response;
          var dw = 0 + response[j] * impulse[0] + response[j + 1] * impulse[1] +
            response[j + 2] * impulse[2] + response[j + 3] * impulse[3];
          body.angularVelocity[k] += sign * dw;
        }
      }
      return;
    }
    contact.body.applyImpulse(impulse, contact.r);
    if (contact.other) contact.other.applyImpulse(M4.scale(impulse, -1), contact.rOther);
  }

  function contactMass(contact, direction) {
    return effectiveMass(contact.body, contact.r, direction) +
      (contact.other ? effectiveMass(contact.other, contact.rOther, direction) : 0);
  }

  function ContactConvergenceError(residual) {
    this.name = 'ContactConvergenceError';
    this.message = 'Contact impulse solver did not converge: ' + residual;
    this.residual = residual;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ContactConvergenceError);
  }
  ContactConvergenceError.prototype = Object.create(Error.prototype);
  ContactConvergenceError.prototype.constructor = ContactConvergenceError;

  var STEP_WORK_LIMIT = 300000, STEP_ATTEMPT_LIMIT = 32, STEP_TIME_LIMIT_MS = 750;

  function StepBudget() {
    this.work = 0;
    this.attempts = 0;
    this.deadline = performance.now() + STEP_TIME_LIMIT_MS;
  }
  StepBudget.prototype.spend = function (work) {
    if (performance.now() >= this.deadline) throw new StepBudgetError('time');
    if (this.work + work > STEP_WORK_LIMIT) throw new StepBudgetError('work');
    this.work += work;
  };
  function StepBudgetError(reason) {
    this.name = 'StepBudgetError';
    this.message = 'Physics step work budget exhausted';
    this.reason = reason || 'work';
  }
  StepBudgetError.prototype = Object.create(Error.prototype);
  StepBudgetError.prototype.constructor = StepBudgetError;

  function solveContacts(contacts, friction, iterations, stepBudget) {
    var pairs = contacts.some(function (c) { return c.other; });
    var strict = iterations !== undefined || pairs, budget = iterations === undefined ? (pairs ? 2048 : 32) : iterations;
    var total = 0, continuations = 0, rounds = 0;
    // Geometry stays fixed during a solve. Cache J and M^-1 J^T, not velocities,
    // so continuation does not repeatedly rebuild world/body inertia transforms.
    contacts.forEach(function (c) {
      c._solverPoints = [pointMap(c.body, c.r)];
      if (c.other) c._solverPoints.push(pointMap(c.other, c.rOther));
    });
    if (friction > 0 && strict) {
      contacts.forEach(function (c) {
        if (c.tangentMass !== undefined) return;
        var trace = 0;
        for (var axis = 0; axis < 4; axis++) {
          var direction = [0, 0, 0, 0]; direction[axis] = 1;
          trace += contactMass(c, direction);
        }
        // 切向响应的 trace 是最大特征值上界。固定安全步长避免各向异性
        // 接触在库仑球边界上因方向 Rayleigh 步长过大而形成二周期振荡。
        c.tangentMass = trace - c.normalMass;
      });
    }
    function converge(mu) {
      var result, previous = Infinity, count = 0, batch = budget;
      do {
        result = iterateContacts(contacts, mu, batch, stepBudget);
        total += result.iterations;
        count += result.iterations;
        if (!strict || result.change <= 1e-12) return result;
        // Continue only while the fixed-point residual contracts. A stalled or
        // exhausted solve is retried from a rolled-back, smaller world step.
        if (result.change >= previous * 0.9 || count >= 32768) {
          throw new ContactConvergenceError(result.change);
        }
        previous = result.change;
        batch = Math.min(batch * 2, 32768 - count);
        continuations++;
      } while (true);
    }
    if (contacts.some(function (c) { return c.other && !c.impactSolved; })) {
      // A simultaneous Newton impact can turn a separating point into a closing
      // one. Propagate further impacts, not a dissipative zero-target clamp.
      // For uniform e each converged round has
      // dT = -(1-e)/(2(1+e)) * lambda^T K lambda, hence dT=0 at e=1.
      do {
        converge(0);
        var closing = contacts.some(function (c) {
          return M4.dot(contactVelocity(c), c.normal || NORMAL) < -1e-10;
        });
        contacts.forEach(function (c) {
          c.impactImpulse = (c.impactImpulse || 0) + c.normalImpulse;
          c.normalImpulse = 0;
          c.target = -(c.restitution || 0) * M4.dot(contactVelocity(c), c.normal || NORMAL);
        });
        rounds++;
        if (closing && rounds >= 64) throw new ContactConvergenceError('impact propagation');
      } while (closing);
      contacts.forEach(function (c) {
        c.target = 0;
        c.impactSolved = true;
      });
    }
    var result = converge(friction);
    return { iterations: total, change: result.change, continuations: continuations, impactRounds: rounds };
  }

  function tangentUpdate(contact, friction, nextNormal, velocity) {
    var normal = contact.normal || NORMAL, vt = velocity || contactVelocity(contact);
    var vn = M4.dot(vt, normal);
    for (var i = 0; i < 4; i++) vt[i] -= normal[i] * vn;
    var speed = M4.len(vt), next = contact.tangentImpulse.slice();
    if (speed > 0 && friction > 0) {
      var mass = contact.tangentMass || contactMass(contact, M4.scale(vt, 1 / speed));
      var inverse = 1 / mass;
      for (i = 0; i < 4; i++) next[i] -= vt[i] * inverse;
    }
    var magnitude = M4.len(next), limit = friction * (nextNormal + (contact.impactImpulse || 0));
    if (magnitude > limit) {
      var ratio = limit / magnitude;
      for (i = 0; i < 4; i++) next[i] *= ratio;
    }
    return next;
  }

  function contactResidual(contacts, friction) {
    var residual = 0;
    contacts.forEach(function (c) {
      var vn = M4.dot(contactVelocity(c), c.normal || NORMAL), target = c.target || 0;
      var next = Math.max(0, c.normalImpulse + (target - vn) / c.normalMass);
      residual = Math.max(residual, Math.abs(next - c.normalImpulse),
        Math.max(0, target - vn), M4.len(M4.sub(tangentUpdate(c, friction, next), c.tangentImpulse)));
    });
    return residual;
  }

  function impulseVector(contacts) {
    var out = new Array(5 * contacts.length);
    for (var i = 0; i < contacts.length; i++) {
      var c = contacts[i], j = 5 * i;
      out[j] = c.normalImpulse;
      for (var k = 0; k < 4; k++) out[j + 1 + k] = c.tangentImpulse[k];
    }
    return out;
  }

  function setImpulses(contacts, values, friction) {
    contacts.forEach(function (c, i) {
      var normal = c.normal || NORMAL, jn = Math.max(0, values[5 * i]);
      var jt = values.slice(5 * i + 1, 5 * i + 5);
      jt = M4.sub(jt, M4.scale(normal, M4.dot(jt, normal)));
      var length = M4.len(jt), limit = friction * (jn + (c.impactImpulse || 0));
      if (length > limit) jt = M4.scale(jt, limit / length);
      contactImpulse(c, M4.add(M4.scale(normal, jn - c.normalImpulse), M4.sub(jt, c.tangentImpulse)));
      c.normalImpulse = jn; c.tangentImpulse = jt;
    });
  }

  function accelerateContacts(contacts, friction, history) {
    var latest = history[history.length - 1], differences = [];
    for (var i = 1; i < history.length; i++) {
      differences.push({
        r: history[i].r.map(function (x, j) { return x - history[i - 1].r[j]; }),
        f: history[i].f.map(function (x, j) { return x - history[i - 1].f[j]; })
      });
    }
    function dot(a, b) { return a.reduce(function (s, x, j) { return s + x * b[j]; }, 0); }
    var size = differences.length, matrix = [], rhs = [], scale = 0;
    for (i = 0; i < size; i++) {
      matrix[i] = differences.map(function (d) { return dot(differences[i].r, d.r); });
      rhs[i] = dot(differences[i].r, latest.r);
      scale = Math.max(scale, matrix[i][i]);
    }
    if (scale === 0) return;
    // Small regularized least-squares problem for Anderson mixing. Redundant
    // contact impulses need not be unique; regularization only chooses a trial
    // direction and never changes the physical residual or acceptance tolerance.
    for (i = 0; i < size; i++) matrix[i][i] += scale * 1e-12;
    for (i = 0; i < size; i++) {
      var pivot = i;
      for (var j = i + 1; j < size; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
      var row = matrix[i]; matrix[i] = matrix[pivot]; matrix[pivot] = row;
      var value = rhs[i]; rhs[i] = rhs[pivot]; rhs[pivot] = value;
      if (Math.abs(matrix[i][i]) < scale * 1e-15) return;
      for (j = i + 1; j < size; j++) {
        var ratio = matrix[j][i] / matrix[i][i];
        for (var k = i; k < size; k++) matrix[j][k] -= ratio * matrix[i][k];
        rhs[j] -= ratio * rhs[i];
      }
    }
    var weights = new Array(size);
    for (i = size - 1; i >= 0; i--) {
      value = rhs[i];
      for (j = i + 1; j < size; j++) value -= matrix[i][j] * weights[j];
      weights[i] = value / matrix[i][i];
    }
    var candidate = latest.f.map(function (x, k) {
      differences.forEach(function (d, j) { x -= weights[j] * d.f[k]; });
      return x;
    });
    if (!candidate.every(Number.isFinite)) return;
    var before = contactResidual(contacts, friction), saved = new Map();
    contacts.forEach(function (c) {
      c._solverPoints.forEach(function (m) {
        if (!saved.has(m.body)) saved.set(m.body, [m.body.velocity.slice(), m.body.angularVelocity.slice()]);
      });
    });
    setImpulses(contacts, candidate, friction);
    if (contactResidual(contacts, friction) < before * 0.9) {
      history.length = 0;
    } else {
      contacts.forEach(function (c, i) {
        c.normalImpulse = latest.f[5 * i];
        c.tangentImpulse = latest.f.slice(5 * i + 1, 5 * i + 5);
      });
      saved.forEach(function (state, body) { body.velocity = state[0]; body.angularVelocity = state[1]; });
    }
  }

  function iterateContacts(contacts, friction, iterations, stepBudget) {
    var residual = 0, history = [], impulse = [0, 0, 0, 0];
    for (var pass = 0; pass < iterations; pass++) {
      if (stepBudget) stepBudget.spend(contacts.length);
      var change = 0, previous = friction > 0 && iterations > 32 ? impulseVector(contacts) : null;
      for (var i = 0; i < contacts.length; i++) {
        var contact = contacts[i], normal = contact.normal || NORMAL;
        var velocity = contactVelocity(contact), vn = M4.dot(velocity, normal);
        var target = contact.target === undefined ? 0 : contact.target;
        var nextNormal = Math.max(0, contact.normalImpulse + (target - vn) / contact.normalMass);
        var deltaNormal = nextNormal - contact.normalImpulse;
        if (deltaNormal !== 0) {
          for (var axis = 0; axis < 4; axis++) impulse[axis] = normal[axis] * deltaNormal;
          contactImpulse(contact, impulse);
        }
        contact.normalImpulse = nextNormal;
        var nextTangent = tangentUpdate(contact, friction, nextNormal, deltaNormal === 0 ? velocity : null);
        for (axis = 0; axis < 4; axis++) impulse[axis] = nextTangent[axis] - contact.tangentImpulse[axis];
        if (impulse[0] !== 0 || impulse[1] !== 0 || impulse[2] !== 0 || impulse[3] !== 0) contactImpulse(contact, impulse);
        contact.tangentImpulse = nextTangent;
        change = Math.max(change, Math.abs(deltaNormal), M4.len(impulse));
      }
      if (previous) {
        var current = impulseVector(contacts);
        history.push({ f: current, r: current.map(function (x, i) { return x - previous[i]; }) });
        if (history.length > 7) history.shift();
        if (history.length >= 3 && pass % 8 === 7) accelerateContacts(contacts, friction, history);
      }
      if (change < 1e-12) {
        residual = contactResidual(contacts, friction);
        if (residual <= 1e-12) break;
      }
    }
    residual = contactResidual(contacts, friction);
    return { iterations: Math.min(pass + 1, iterations), change: residual };
  }

  function World4(options) {
    var o = options || {};
    this.bodies = [];
    this.gravity = o.gravity === undefined ? 9.81 : o.gravity;
    this.restitution = o.restitution === undefined ? 0.45 : o.restitution;
    this.friction = o.friction === undefined ? 0.6 : o.friction;
    this.floorY = o.floorY === undefined ? -1.5 : o.floorY;
    this.floorEnabled = o.floor !== false;
    this.resetDiagnostics();
  }

  World4.prototype.resetDiagnostics = function () {
    this._collisionContacts = [];
    this._solverResult = null;
    this._solverSubdivisions = 0;
    this._stepBudget = null;
    this._failedStep = null;
    this.stepResult = null;
    this.skippedSteps = 0;
  };

  function integrateWorld(dt) {
    for (var i = 0; i < this.bodies.length; i++) {
      var body = this.bodies[i];
      if (!this.floorEnabled) {
        body.step(dt, this.gravity, this._stepBudget);
        continue;
      }
      var gap = floorContacts(body, this.floorY).separation;
      var saved = null;
      if (gap > 1e-7) {
        saved = {
          position: body.position.slice(), velocity: body.velocity.slice(),
          orientation: body.orientation.slice(), angularVelocity: body.angularVelocity.slice(),
          force: body.force.slice(), torque: body.torque.slice()
        };
      }
      body.step(dt, this.gravity, this._stepBudget);
      if (saved && floorContacts(body, this.floorY).depth > 0) {
        /* 悬空落地时若走完整步再抬回地面，弹性反弹会获得额外势能。
           在同一个半隐式离散轨迹上二分落地时刻，再积分余下时间；
           已在接触中的支撑仍交给接触求解器，不做零时长碰撞循环。
           这里只处理步首在外、步末穿透的过零，不是完整的旋转 CCD。 */
        var lo = 0, hi = dt;
        for (var j = 0; j < 32; j++) {
          restoreBody(body, saved);
          var mid = (lo + hi) / 2;
          body.step(mid, this.gravity, this._stepBudget);
          if (floorContacts(body, this.floorY).depth > 0) hi = mid;
          else lo = mid;
        }
        restoreBody(body, saved);
        body.step(hi, this.gravity, this._stepBudget);
        collideFloor(body, this);
        if (dt > hi) {
          body.force = saved.force.slice();
          body.torque = saved.torque.slice();
          body.step(dt - hi, this.gravity, this._stepBudget);
        }
      }
      collideFloor(body, this);
    }
    if (global.Collide4 && this.bodies.length > 1) global.Collide4.solveWorld(this);
  }

  function snapshot(body) {
    var saved = {};
    ['position', 'velocity', 'orientation', 'angularVelocity', 'force', 'torque'].forEach(function (key) {
      saved[key] = body[key].slice();
    });
    return saved;
  }

  function advanceWorld(world, dt, depth) {
    var saved = world.bodies.map(snapshot), contacts = world._collisionContacts, result = world._solverResult;
    try {
      if (world._stepBudget.attempts >= STEP_ATTEMPT_LIMIT) throw new StepBudgetError();
      world._stepBudget.attempts++;
      integrateWorld.call(world, dt);
    } catch (error) {
      world.bodies.forEach(function (body, i) { restoreBody(body, saved[i]); });
      world._collisionContacts = contacts;
      world._solverResult = result;
      if (!(error instanceof ContactConvergenceError) || depth >= 8) throw error;
      world._solverSubdivisions++;
      try {
        advanceWorld(world, dt / 2, depth + 1);
        world.bodies.forEach(function (body, i) {
          body.force = saved[i].force.slice();
          body.torque = saved[i].torque.slice();
        });
        advanceWorld(world, dt / 2, depth + 1);
      } catch (retryError) {
        world.bodies.forEach(function (body, i) { restoreBody(body, saved[i]); });
        world._collisionContacts = contacts;
        world._solverResult = result;
        throw retryError;
      }
    }
  }

  World4.prototype.step = function (dt, frameBudget) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('时间步长必须为有限非负数');
    this._solverSubdivisions = 0;
    var failed = this._failedStep;
    // A rolled-back state is identical on the next frame. Do not repeatedly
    // spend the entire budget on the same deterministic failed calculation.
    // Any physics input (including force/torque), body or cache change retries.
    if (failed && performance.now() < failed.expires && failed.key === stepKey(this, dt) &&
        failed.bodies.every(function (body, i) { return body === this.bodies[i]; }, this) &&
        failed.contacts === this._collisionContacts && failed.solver === (global.Collide4 && global.Collide4.solveWorld)) {
      this.skippedSteps++;
      this.stepResult = Object.assign({}, failed.result, { cached: true, work: 0, attempts: 0 });
      return this.stepResult;
    }
    this._failedStep = null;
    var budget = this._stepBudget = frameBudget || new StepBudget(), initialWork = budget.work;
    this.stepResult = null;
    try {
      advanceWorld(this, dt, 0);
      this.stepResult = { advanced: true, advancedTime: dt, work: budget.work, attempts: budget.attempts };
    } catch (error) {
      var collisionFailure = global.Collide4 && typeof global.Collide4.ConvergenceError === 'function' &&
        error instanceof global.Collide4.ConvergenceError;
      if (!(error instanceof ContactConvergenceError) && !(error instanceof StepBudgetError) && !collisionFailure) throw error;
      this.skippedSteps++;
      this.stepResult = { advanced: false, advancedTime: 0,
        reason: error instanceof StepBudgetError ? (error.reason === 'time' ? 'time' : 'budget') : 'convergence',
        residual: error.residual, work: budget.work, attempts: budget.attempts, cached: false };
      if (initialWork === 0 || error instanceof ContactConvergenceError || collisionFailure) {
        this._failedStep = { key: stepKey(this, dt), bodies: this.bodies.slice(), contacts: this._collisionContacts,
          solver: global.Collide4 && global.Collide4.solveWorld, result: this.stepResult,
          expires: this.stepResult.reason === 'time' ? performance.now() + 1000 : Infinity };
      }
    } finally {
      this._stepBudget = null;
    }
    return this.stepResult;
  };

  function stepKey(world, dt) {
    return JSON.stringify([dt, world.gravity, world.restitution, world.friction,
      world.floorY, world.floorEnabled, world.bodies, world._collisionContacts]);
  }

  function restoreBody(body, saved) {
    Object.keys(saved).forEach(function (key) { body[key] = saved[key].slice(); });
  }

  global.Physics4 = {
    PLANES: PLANES, toMatrix: toMatrix, fromMatrix: fromMatrix,
    wedge: wedge, commutator: commutator, act: act, transform: transform,
    dot6: dot6, mul6: mul6, inverseInertia: inverseInertia,
    inertiaBox4: inertiaBox4, inertiaGlome: inertiaGlome,
    effectiveMass: effectiveMass, floorContacts: floorContacts, collideFloor: collideFloor,
    contactVelocity: contactVelocity, contactMass: contactMass, solveContacts: solveContacts,
    ContactConvergenceError: ContactConvergenceError,
    StepBudget: StepBudget, STEP_WORK_LIMIT: STEP_WORK_LIMIT, STEP_ATTEMPT_LIMIT: STEP_ATTEMPT_LIMIT,
    STEP_TIME_LIMIT_MS: STEP_TIME_LIMIT_MS,
    RigidBody4: RigidBody4, World4: World4
  };
  global.RigidBody4 = RigidBody4;
})(window);

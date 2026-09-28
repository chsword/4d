'use strict';

global.window = global;
require('../js/m4.js');
require('../js/physics4.js');

var P = Physics4, passed = 0, failed = 0;

function assert(ok, message) { if (!ok) throw new Error(message); }
function near(a, b, eps, message) {
  assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps,
    message + ': ' + a + ' vs ' + b + ' (限值 ' + eps + ')');
}
function vectorNear(a, b, eps, message) {
  assert(a.length === b.length, message + ' 维数');
  a.forEach(function (x, i) { near(x, b[i], eps, message + '[' + i + ']'); });
}
function test(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (err) { failed++; console.error('FAIL ' + name + '\n' + err.stack); }
}
function throws(fn, message) {
  var caught = false;
  try { fn(); } catch (err) { caught = true; }
  assert(caught, message);
}
function norm(a) { return Math.sqrt(a.reduce(function (s, x) { return s + x * x; }, 0)); }
function difference(a, b) { return norm(a.map(function (x, i) { return x - b[i]; })); }
function rotation() {
  return M4.compose([M4.rotation('xy', 0.37), M4.rotation('xw', -0.63),
    M4.rotation('yz', 0.29), M4.rotation('zw', 0.46)]);
}
function asymmetricBody(extra) {
  return new RigidBody4(Object.assign({
    mass: 2.3, halfSize: [0.45, 0.7, 1.05, 1.35],
    orientation: rotation(), angularVelocity: [0.7, -0.4, 0.55, 0.9, -0.3, 0.65],
    velocity: [0.3, -0.1, 0.2, 0.4]
  }, extra));
}

test('基底顺序、楔积反对称性和矩阵往返', function () {
  assert(P.PLANES.join(',') === 'xy,xz,xw,yz,yw,zw', '基底顺序');
  assert(P.PLANES.join(',') === M4.PLANES.join(','), 'M4 顺序');
  var a = [2, -3, 5, 7], b = [-4, 6, 1, 9];
  vectorNear(P.wedge(a, b), P.wedge(b, a).map(function (x) { return -x; }), 0, '反对称');
  vectorNear(P.wedge(a, a), [0, 0, 0, 0, 0, 0], 0, '自身楔积');
  var omega = [0.3, -0.9, 0.7, 1.1, -2.3, 0.8], A = P.toMatrix(omega);
  vectorNear(P.fromMatrix(A), omega, 0, '往返');
  vectorNear(M4.transpose(A), A.map(function (x) { return -x; }), 0, '反对称矩阵');
  near(P.dot6(P.wedge(a, b), omega), M4.dot(b, P.act(omega, a)), 1e-13, '做功符号');
  P.PLANES.forEach(function (plane, k) {
    var unit = [0, 0, 0, 0, 0, 0]; unit[k] = 1;
    var dR = M4.rotation(plane, 1e-6).map(function (x, i) { return (x - M4.ident()[i]) / 1e-6; });
    vectorNear(dR, P.toMatrix(unit), 5.1e-7, '与 M4.rotation 同号 ' + plane);
  });
});

test('对易子与坐标变换满足矩阵定义', function () {
  var a = [1, 2, -1, 0.5, -0.2, 0.3], b = [-0.3, 0.8, 1.2, -1, 2, 0.7];
  var AB = M4.mul(P.toMatrix(a), P.toMatrix(b)), BA = M4.mul(P.toMatrix(b), P.toMatrix(a));
  vectorNear(P.toMatrix(P.commutator(a, b)), AB.map(function (x, i) { return x - BA[i]; }), 1e-14, '对易子');
  var R = rotation(), r = [0.3, -0.5, 1, 0.2];
  vectorNear(P.act(P.transform(a, R), M4.mulVec(R, r)), M4.mulVec(R, P.act(a, r)), 1e-14, '作用的协变性');
  vectorNear(P.transform(P.wedge(r, [1, 2, 3, 4]), R),
    P.wedge(M4.mulVec(R, r), M4.mulVec(R, [1, 2, 3, 4])), 1e-14, '楔积的协变性');
});

test('盒子与实心超球惯性：解析值、对称、正定、逆矩阵', function () {
  var box = P.inertiaBox4(3, [1, 2, 3, 4]), sphere = P.inertiaGlome(3, 2);
  vectorNear([box[0], box[7], box[14], box[21], box[28], box[35]], [5, 10, 17, 13, 20, 25], 0, '盒子解析惯性');
  [box, sphere].forEach(function (I) {
    var inv = P.inverseInertia(I);
    for (var i = 0; i < 6; i++) {
      for (var j = 0; j < 6; j++) {
        near(box[i * 6 + j], i === j ? [5, 10, 17, 13, 20, 25][i] : 0, 0, '全部盒子惯性解析项');
        near(sphere[i * 6 + j], i === j ? 4 : 0, 0, '全部超球惯性解析项');
        near(I[i * 6 + j], I[j * 6 + i], 0, '对称');
        var s = 0;
        for (var k = 0; k < 6; k++) s += I[i * 6 + k] * inv[k * 6 + j];
        near(s, i === j ? 1 : 0, 1e-14, '逆矩阵');
      }
      assert(I[i * 6 + i] > 0, '对角惯性的全部特征值为正');
      near(sphere[i * 6 + i], 4, 0, '超球解析惯性');
    }
  });
  // 用张量积二点积分独立核对 ∫|Ωr|² dm，能抓住漏项、维数和符号错误。
  var omega = [0.7, -0.4, 0.9, -0.2, 0.6, 1.2], integrated = 0;
  for (var mask = 0; mask < 16; mask++) {
    var r = [1, 2, 3, 4].map(function (h, k) { return ((mask & (1 << k)) ? h : -h) / Math.sqrt(3); });
    var v = P.act(omega, r);
    integrated += 0.5 * 3 / 16 * M4.dot(v, v);
  }
  near(integrated, 0.5 * P.dot6(omega, P.mul6(box, omega)), 1e-13, '质量分布积分');
});

test('无效质量、尺寸、惯性和时间步长明确报错', function () {
  throws(function () { return new RigidBody4({ mass: 0 }); }, '零质量');
  throws(function () { return new RigidBody4({ halfSize: [1, -1, 1, 1] }); }, '负边长');
  throws(function () { return new RigidBody4({ shape: 'glome', radius: NaN }); }, 'NaN 半径');
  var I = P.inertiaBox4(1, [1, 1, 1, 1]); I[1] = 1;
  throws(function () { return new RigidBody4({ inertia: I }); }, '非对称惯性');
  I[1] = 0; I[0] = -1;
  throws(function () { return new RigidBody4({ inertia: I }); }, '非正定惯性');
  throws(function () { asymmetricBody().step(-1, 0); }, '负时间步长');
});

test('半隐式平移、世界力矩与偏心冲量', function () {
  var body = asymmetricBody(), p0 = body.position.slice(), v0 = body.velocity.slice();
  var L0 = body.worldAngularMomentum(), force = [3, 5, -2, 7], r = [0.3, -0.5, 0.6, 0.8], h = 0.01;
  body.applyForce(force, M4.add(body.position, r));
  body.step(h, 2);
  vectorNear(body.velocity, v0.map(function (v, i) { return v + h * (force[i] / body.mass - (i === 1 ? 2 : 0)); }), 1e-14, 'kick');
  vectorNear(body.position, p0.map(function (p, i) { return p + h * body.velocity[i]; }), 1e-14, 'drift');
  vectorNear(body.worldAngularMomentum(), L0.map(function (x, i) { return x + h * P.wedge(r, force)[i]; }), 1e-13, '外力矩');
  vectorNear(body.force, [0, 0, 0, 0], 0, '清空力');
  vectorNear(body.torque, [0, 0, 0, 0, 0, 0], 0, '清空力矩');
  L0 = body.worldAngularMomentum();
  body.applyImpulse(force, r);
  vectorNear(body.worldAngularMomentum(), L0.map(function (x, i) { return x + P.wedge(r, force)[i]; }), 1e-13, '冲量矩');
});

test('120 秒自由翻滚：世界 L 六分量、动能、姿态正交，body ω 确实变化', function () {
  var body = asymmetricBody(), L0 = body.worldAngularMomentum(), E0 = body.kineticEnergy();
  var w0 = body.angularVelocity.slice(), maxL = 0, maxE = 0, maxW = 0, maxOrth = 0;
  for (var i = 0; i < 28800; i++) {
    body.step(1 / 240, 0);
    maxL = Math.max(maxL, difference(body.worldAngularMomentum(), L0) / norm(L0));
    maxE = Math.max(maxE, Math.abs(body.kineticEnergy() / E0 - 1));
    maxW = Math.max(maxW, difference(body.angularVelocity, w0));
    var gram = M4.mul(M4.transpose(body.orientation), body.orientation);
    maxOrth = Math.max(maxOrth, difference(gram, M4.ident()));
  }
  assert(maxL < 1e-9, '世界 L 相对漂移 ' + maxL);
  assert(maxE < 1e-8, '能量相对漂移 ' + maxE);
  assert(maxOrth < 1e-12, '正交误差 ' + maxOrth);
  assert(maxW > 0.3, '角速度没有发生自由翻滚 ' + maxW);
  console.log('  L 漂移=' + maxL.toExponential(3) + ', E 漂移=' + maxE.toExponential(3) +
    ', 正交误差=' + maxOrth.toExponential(3) + ', max|Δω|=' + maxW.toFixed(3));
});

test('欧拉方程的局部导数包含 -[ω,L]，非对角 6×6 惯性也适用', function () {
  var body = asymmetricBody(), I = body.inertia.slice();
  I[1] = I[6] = 0.07; I[11] = I[31] = -0.04;
  body = asymmetricBody({ inertia: I });
  var w0 = body.angularVelocity.slice(), h = 1e-6;
  var rhs = P.mul6(body.invInertia, P.commutator(w0, P.mul6(I, w0))).map(function (x) { return -x; });
  body.step(h, 0);
  vectorNear(body.angularVelocity.map(function (x, i) { return (x - w0[i]) / h; }), rhs, 2e-6, 'Euler 方程');
  var L0 = body.worldAngularMomentum(), E0 = body.kineticEnergy();
  for (var i = 0; i < 7200; i++) body.step(1 / 240, 0);
  vectorNear(body.worldAngularMomentum(), L0, 1e-9, '非对角惯性 L');
  near(body.kineticEnergy() / E0, 1, 1e-8, '非对角惯性 E');
});

test('等方超球的 ω 恒定，姿态积分与可交换双旋转一致', function () {
  var body = new RigidBody4({ shape: 'glome', angularVelocity: [0.7, 0, 0, 0, 0, -0.4] });
  for (var i = 0; i < 2400; i++) body.step(1 / 240, 0);
  vectorNear(body.angularVelocity, [0.7, 0, 0, 0, 0, -0.4], 1e-10, '等方惯性');
  vectorNear(body.orientation, M4.mul(M4.rotation('xy', 7), M4.rotation('zw', -4)), 1e-8, '双旋转解析解');
});

test('面板最大步长 16 ms 下自由翻滚仍保持守恒', function () {
  var body = asymmetricBody(), E0 = body.kineticEnergy(), L0 = body.worldAngularMomentum();
  for (var i = 0; i < 3750; i++) {
    body.step(0.016, 0);
    assert(Math.abs(body.kineticEnergy() / E0 - 1) < 1e-8, '最大步长能量漂移');
    assert(difference(body.worldAngularMomentum(), L0) / norm(L0) < 1e-9, '最大步长角动量漂移');
  }
});

test('三维退化：楔积、对易子、欧拉导数与标准叉积公式一致', function () {
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function axial(b) { return [b[3], -b[1], b[0]]; }
  var a = [2, -1, 3, 0], b = [-4, 5, 2, 0];
  vectorNear(axial(P.wedge(a, b)), cross(a, b), 0, 'r×F');
  var omega = [0.7, -0.4, 0, 0.9, 0, 0], body = new RigidBody4({
    mass: 3, halfSize: [1, 2, 3, 0], angularVelocity: omega
  });
  var w = axial(omega), inertia3 = [13, 10, 5], L = w.map(function (x, i) { return x * inertia3[i]; });
  vectorNear(axial(P.mul6(body.inertia, omega)), L, 0, '三维盒子惯性');
  vectorNear(P.act(omega, a), cross(w, a).concat(0), 1e-14, 'ω×r');
  vectorNear(axial(P.commutator(omega, P.mul6(body.inertia, omega))), cross(w, L), 1e-14, 'ω×L');
  var derivative = cross(w, L).map(function (x, i) { return -x / inertia3[i]; });
  body.step(1e-6, 0);
  vectorNear(axial(body.angularVelocity).map(function (x, i) { return (x - w[i]) / 1e-6; }), derivative, 1e-6, '三维 Euler 导数');
  for (var i = 0; i < 2400; i++) body.step(1 / 240, 0);
  vectorNear([body.angularVelocity[2], body.angularVelocity[4], body.angularVelocity[5]], [0, 0, 0], 1e-14, '不凭空进入 w 平面');
  vectorNear(M4.col(body.orientation, 3), [0, 0, 0, 1], 1e-14, 'w 轴不动');
});

test('三维退化 120 秒逐点对照独立经典 Euler RK4 轨迹', function () {
  var body = new RigidBody4({ mass: 3, halfSize: [1, 2, 3, 0], angularVelocity: [0.7, -0.4, 0, 0.9, 0, 0] });
  var w = [0.9, 0.4, 0.7], maxError = 0;
  function derivative(v) { return [5 * v[1] * v[2] / 13, -8 * v[2] * v[0] / 10, 3 * v[0] * v[1] / 5]; }
  function shifted(v, d, h) { return v.map(function (x, i) { return x + h * d[i]; }); }
  for (var step = 0; step < 28800; step++) {
    body.step(1 / 240, 0);
    for (var j = 0; j < 4; j++) {
      var h = 1 / 960, a = derivative(w), b = derivative(shifted(w, a, h / 2));
      var c = derivative(shifted(w, b, h / 2)), d = derivative(shifted(w, c, h));
      w = w.map(function (x, i) { return x + h * (a[i] + 2 * b[i] + 2 * c[i] + d[i]) / 6; });
    }
    maxError = Math.max(maxError, difference([body.angularVelocity[3], -body.angularVelocity[1], body.angularVelocity[0]], w));
    vectorNear([body.angularVelocity[2], body.angularVelocity[4], body.angularVelocity[5]], [0, 0, 0], 0, 'w 分量不泄漏');
  }
  assert(maxError < 1e-8, '120 s 独立 Euler 轨迹误差 ' + maxError);
  console.log('  independent Euler max error=' + maxError.toExponential(3));
});

test('非等边盒子一般等倾双旋转 120 秒保持六分量 omega 恒定', function () {
  var omega = P.transform([0.7, 0, 0, 0, 0, 0.7], rotation());
  var body = asymmetricBody({ angularVelocity: omega }), maxError = 0;
  for (var i = 0; i < 28800; i++) {
    body.step(1 / 240, 0);
    maxError = Math.max(maxError, difference(body.angularVelocity, omega));
  }
  assert(maxError < 1e-10, '非主平面等倾角速度漂移 ' + maxError);
  console.log('  isoclinic max omega drift=' + maxError.toExponential(3));
});

test('碰撞有效质量包含四维角向贡献，与真实冲量响应一致', function () {
  var body = asymmetricBody(), r = [0.4, -0.8, 0.3, 0.7], n = M4.normalize([1, 2, -1, 3]);
  var K = P.effectiveMass(body, r, n), v0 = body.pointVelocity(r);
  assert(K > body.invMass, '漏掉角向有效质量');
  body.applyImpulse(n, r);
  near(M4.dot(n, M4.sub(body.pointVelocity(r), v0)), K, 1e-13, '有效质量响应');
  var thin = new RigidBody4({ mass: 3, halfSize: [1, 2, 3, 0] });
  var expected = 1 / 3 + 0.4 * 0.4 / 5 + 0.3 * 0.3 / 13;
  near(P.effectiveMass(thin, [0.4, -2, 0.3, 0], [0, 1, 0, 0]), expected, 1e-14, '三维接触退化');
});

test('16 顶点最深穿透投影、超球中心距离与无接触不变性', function () {
  var body = asymmetricBody({ position: [0, -1.2, 0, 0] }), minY = Infinity;
  for (var mask = 0; mask < 16; mask++) {
    var v = body.halfSize.map(function (h, k) { return mask & (1 << k) ? h : -h; });
    minY = Math.min(minY, body.position[1] + M4.mulVec(body.orientation, v)[1]);
  }
  near(P.floorContacts(body).depth, -1.5 - minY, 1e-14, '最深穿透');
  P.collideFloor(body, { restitution: 0 });
  near(P.floorContacts(body).depth, 0, 1e-14, '投影到地面');
  var sphere = new RigidBody4({ shape: 'glome', radius: 0.7, position: [0, -1, 0, 0] });
  near(P.floorContacts(sphere).depth, 0.2, 1e-14, '球中心距离');
  sphere.position[1] = 5;
  assert(!P.collideFloor(sphere), '悬空无碰撞');
  near(sphere.position[1], 5, 0, '悬空位置不变');
});

test('恢复系数的解析反弹、摩擦锥以及每次接触动能不增加', function () {
  [0, 0.3, 1].forEach(function (e) {
    var body = new RigidBody4({ shape: 'glome', radius: 0.7, position: [0, -0.8, 0, 0], velocity: [0, -3, 0, 0] });
    P.collideFloor(body, { restitution: e, friction: 0 });
    near(body.velocity[1], 3 * e, 1e-12, '反弹');
    near(body.kineticEnergy(), 4.5 * e * e, 1e-12, '反弹能量');
  });
  var slide = new RigidBody4({ shape: 'glome', radius: 0.7, position: [0, -0.8, 0, 0], velocity: [3, -2, -4, 5] });
  var v0 = slide.velocity.slice(), mu = 0.2;
  P.collideFloor(slide, { restitution: 0, friction: mu });
  var impulse = M4.scale(M4.sub(slide.velocity, v0), slide.mass), normalImpulse = impulse[1];
  impulse[1] = 0;
  near(M4.len(impulse), mu * normalImpulse, 1e-12, '三维切空间的库仑摩擦锥');
  assert(Math.abs(slide.velocity[3]) < 5, '第四维也有摩擦');
  for (var k = 0; k < 60; k++) {
    var body = asymmetricBody({
      position: [0, -0.7, 0, 0], orientation: M4.mul(rotation(), M4.rotation('yw', k * 0.17)),
      velocity: [Math.sin(k), -1 - k / 10, Math.cos(k), 0.5]
    });
    var E = body.kineticEnergy();
    P.collideFloor(body, { restitution: (k % 3) / 2, friction: 0.7 });
    assert(body.kineticEnergy() <= E + 1e-11, '接触制造动能，case=' + k);
  }
});

test('落体能量不超初始值；e=0 的球与平放盒子最终静止且不下陷', function () {
  ['glome', 'box4'].forEach(function (shape) {
    var world = new P.World4({ restitution: 0, friction: 0.7 });
    var body = new RigidBody4({ shape: shape, position: [0, 3, 0, 0] });
    world.bodies.push(body);
    var E0 = body.mass * world.gravity * (body.position[1] - world.floorY);
    var touched = false;
    for (var i = 0; i < 7200; i++) {
      world.step(1 / 240);
      touched = touched || P.floorContacts(body).contacts.length > 0;
      var E = body.kineticEnergy() + body.mass * world.gravity * (body.position[1] - world.floorY);
      assert(E <= E0 + 1e-8, shape + ' 落体能量增加');
    }
    assert(touched, shape + ' 没有撞到地板');
    assert(norm(body.velocity) < 1e-7, shape + ' 线速度未静止 ' + norm(body.velocity));
    assert(norm(body.angularVelocity) < 1e-7, shape + ' 角速度未静止 ' + norm(body.angularVelocity));
    assert(P.floorContacts(body).depth < 1e-10, shape + ' 下陷');
  });
});

test('带四维初始翻滚的非等边盒子在零恢复地板上最终静止', function () {
  var world = new P.World4({ restitution: 0, friction: 0.7 });
  var body = asymmetricBody({ position: [0, 3, 0, 0] });
  world.bodies.push(body);
  for (var i = 0; i < 7200; i++) world.step(1 / 240);
  assert(norm(body.velocity) < 1e-7, '翻滚后线速度未静止 ' + norm(body.velocity));
  assert(norm(body.angularVelocity) < 1e-7, '翻滚后角速度未静止 ' + norm(body.angularVelocity));
  assert(P.floorContacts(body).depth < 1e-10, '翻滚后下陷');
});

test('完全弹性落体不会因穿透位置修正而越弹越高', function () {
  [1 / 240, 0.016].forEach(function (dt) {
    var world = new P.World4({ restitution: 1, friction: 0 });
    var body = new RigidBody4({ shape: 'glome', position: [0, 3, 0, 0] });
    world.bodies.push(body);
    var E0 = body.mass * world.gravity * (body.position[1] - world.floorY), bounces = 0, vy = 0;
    for (var i = 0; i < Math.ceil(30 / dt); i++) {
      world.step(dt);
      var E = body.kineticEnergy() + body.mass * world.gravity * (body.position[1] - world.floorY);
      assert(E <= E0 + 1e-8, '弹性落体增加机械能，dt=' + dt + ', ΔE=' + (E - E0));
      if (vy < -1 && body.velocity[1] > 1) bounces++;
      vy = body.velocity[1];
    }
    assert(bounces > 5, '必须真正反弹，不能靠冻结或关闭恢复系数过测试');
  });
});

test('落地拆分时间步不会重复或丢失外力与外力矩', function () {
  var world = new P.World4({ restitution: 0.6, friction: 0 });
  var body = new RigidBody4({ shape: 'glome', position: [0, -0.8, 0, 0], velocity: [0, -2, 0, 0] });
  var torque = [0, 0, 0.2, 0, 0, 0], dt = 0.1;
  body.applyForce([2, 0, 0, 0]);
  body.applyTorque(torque);
  world.bodies.push(body);
  world.step(dt);
  near(body.velocity[0], 0.2, 1e-13, '总外力冲量');
  vectorNear(body.worldAngularMomentum(), torque.map(function (x) { return x * dt; }), 1e-12, '总外力矩冲量');
  vectorNear(body.force, [0, 0, 0, 0], 0, '外力清空');
  vectorNear(body.torque, [0, 0, 0, 0, 0, 0], 0, '外力矩清空');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

/* m4.js —— 四维线性代数
 *
 * 矩阵：长度 16 的普通数组，行主序（m[r * 4 + c]）
 * 向量：长度 4 的普通数组 [x, y, z, w]
 *
 * 4D 与 3D 最大的区别：3D 的旋转有一根不动的轴，4D 的旋转有一个不动的
 * 平面。四个坐标轴两两组合出 6 个旋转平面（xy xz xw yz yw zw），
 * 对应 SO(4) 的 6 个自由度。其中 xy/xz/yz 是"我们看得见的 3D 旋转"，
 * xw/yw/zw 才是把第四维搅进来的那三个。
 */
(function (global) {
  'use strict';

  var AXIS = { x: 0, y: 1, z: 2, w: 3 };
  var PLANES = ['xy', 'xz', 'xw', 'yz', 'yw', 'zw'];

  function ident() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function mul(a, b) {
    var o = new Array(16);
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var s = 0;
        for (var k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
        o[r * 4 + c] = s;
      }
    }
    return o;
  }

  /* 依次左乘：compose([A, B, C]) === A·B·C */
  function compose(list) {
    var m = ident();
    for (var i = 0; i < list.length; i++) m = mul(m, list[i]);
    return m;
  }

  function mulVec(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
      m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
      m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
      m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3]
    ];
  }

  /* 绕 plane 指定的平面旋转 angle 弧度（Givens 旋转） */
  function rotation(plane, angle) {
    var i = AXIS[plane[0]], j = AXIS[plane[1]];
    var m = ident(), c = Math.cos(angle), s = Math.sin(angle);
    m[i * 4 + i] = c; m[i * 4 + j] = -s;
    m[j * 4 + i] = s; m[j * 4 + j] = c;
    return m;
  }

  function transpose(m) {
    return [
      m[0], m[4], m[8], m[12],
      m[1], m[5], m[9], m[13],
      m[2], m[6], m[10], m[14],
      m[3], m[7], m[11], m[15]
    ];
  }

  /* 第 c 列，作为向量取出（列 = 该矩阵把基向量 e_c 送去的地方） */
  function col(m, c) {
    return [m[c], m[4 + c], m[8 + c], m[12 + c]];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  }

  function len(a) { return Math.sqrt(dot(a, a)); }

  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s, a[3] * s]; }

  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]; }

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]]; }

  function normalize(a) {
    var l = len(a);
    return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0, 0];
  }

  /* 对列做 Gram-Schmidt。连续累乘旋转矩阵几万帧后会有浮点漂移，
     每帧收一次就永远不会变形。 */
  function orthonormalize(m) {
    var cols = [col(m, 0), col(m, 1), col(m, 2), col(m, 3)];
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < i; j++) {
        cols[i] = sub(cols[i], scale(cols[j], dot(cols[i], cols[j])));
      }
      cols[i] = normalize(cols[i]);
    }
    var o = new Array(16);
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) o[r * 4 + c] = cols[c][r];
    }
    return o;
  }

  /* 4D → 3D 透视投影。
     观察者站在第四维上的 (0,0,0,eye)，朝 w 减小的方向看。
     w 越接近 eye 的部分放大得越厉害 —— 这就是超立方体那个
     "盒中盒" 图像的来源：内层的小盒其实是离我们更远的那个立方体胞。 */
  function project4to3(v, eye) {
    var k = eye / (eye - v[3]);
    return [v[0] * k, v[1] * k, v[2] * k, k];   // 第 4 个分量带回缩放比，方便着色
  }

  /* 4D → 3D 正交投影：直接丢掉 w。形状不失真但会自我重叠。 */
  function ortho4to3(v) {
    return [v[0], v[1], v[2], 1];
  }

  /* S³ 的立体投影（从北极 w = 1 投影到 w = 0 超平面）。
     只对单位球面上的点有意义，Hopf 纤维化用它。 */
  function stereo4to3(v) {
    var d = 1 - v[3];
    if (Math.abs(d) < 1e-4) d = 1e-4;
    return [v[0] / d, v[1] / d, v[2] / d, 1 / d];
  }

  global.M4 = {
    AXIS: AXIS, PLANES: PLANES,
    ident: ident, mul: mul, compose: compose, mulVec: mulVec,
    rotation: rotation, transpose: transpose, col: col,
    dot: dot, len: len, scale: scale, add: add, sub: sub,
    normalize: normalize, orthonormalize: orthonormalize,
    project4to3: project4to3, ortho4to3: ortho4to3, stereo4to3: stereo4to3
  };
})(window);

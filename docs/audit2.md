# 第二轮审查：修复本身是否可靠

审查日期：2026-09-28。范围：`git diff dc958a1..b08f1f0`，行号指 `b08f1f0`。第一轮报告 `docs/audit.md` 未修改；仓库内本轮只写本文件，没有修改实现、测试，没有 commit/push。实验使用 Node v24.18.1、内存中的历史源码和仓库外的隔离实验。

**确认两条问题：F16 仍会在合法控件组合下耗尽八层、停掉物理页签，失败重试还会同步阻塞数秒；F15 的物体存在性验收仍可能被辅助线骗过。没有确认第三条，不凑数。六项指定物理性质没有发现回归，F03 未发现以穿透换取终止；完整变异套件实际 25/25 通过，删掉真实新断言也确实能让它报失败。**

本报告区分三个概念：**新引入的问题、旧问题未完全修好、验证证据本身不可靠**。变异实验只证明漏测，不把人为改坏后的行为说成当前产品已经存在的故障。“高/中/低”表示影响程度，不沿用第一轮把 P1/P2/P3 当作问题类别的编号。

## 一、首先纠正比较基线

`2ff7b21` 已经包含 F16/F17 的全部物理修复，**不是 Anderson/回滚/细分引入之前的版本**。它适合作为第二次提交补强 P3 测试之前的基线，但不能单独用来回答物理修复是否引入性能回归。

```sh
git rev-parse dc958a1:js/physics4.js 2ff7b21:js/physics4.js b08f1f0:js/physics4.js
git diff 2ff7b21..b08f1f0 -- js/physics4.js js/collide4.js js/view-physics.js
```

三个物理文件在后两个提交间没有差异。`physics4.js` 的 blob 分别是：

```text
0b0a8b412b69656594f3a3fc3d80394aa65ae532
d314556d5eba839552359606822c365bf58bd95c
d314556d5eba839552359606822c365bf58bd95c
```

因此下面把真正修复前的 `dc958a1` 纳入对比，也保留要求提及的 `2ff7b21`。

## 二、确定发现

### A01 · F16 仍在合法控件组合下失败；细分把同一次失败的阻塞放大到数秒 — 高

**位置：** `js/physics4.js:399–414,640–662`；`js/app.js:459–472`；`js/view-physics.js:161–173`。漏掉的参数域在 `test/collide4.test.js:635–653`，实际控件在 `index.html:355–372`。

**性质：旧问题未完全修好，另有失败路径的性能回归。** 不是惯性张量或自由运动被改坏，也不是要求算法对任意病态输入无限续算。

无需自造高塔、异常质量、初始深穿透或投掷：选物理页签，设置**重力 20、恢复系数 0.45、摩擦 1.5、步长 2 ms**，点击“重置场景”。这都是现有滑块的合法值，恢复系数还是默认值。

默认六体在第 **134** 次调用（零起始索引 133，步首模拟时间 **0.266 s**）抛出：

```text
Contact impulse solver did not converge: 2.526792318949134e-8
```

不是仅仅记录一项诊断后继续运行。主循环设置 `v.error`，之后不再更新/绘制该页签。实际 `app.js` 的 DOM 事件回放中，每帧推进 50 ms，**第六帧出现 fatal**。错误文案确实提示复位；“重置场景”也确实清错并恢复更新，其他页签可用——第一轮“复位也救不回来”的部分已经修好。但参数不变时复位不能消除这个确定性故障。

**我如何独立确认：** 以下不改文件，在两个版本上运行同一场景；同时测量失败调用耗时、检查事务回滚。

```sh
for rev in dc958a1 b08f1f0; do REV="$rev" node <<'NODE'
const cp = require('child_process'), vm = require('vm');
global.window = global;
for (const f of ['m4', 'physics4', 'collide4']) {
  vm.runInThisContext(cp.execFileSync('git',
    ['show', process.env.REV + ':js/' + f + '.js'], {encoding: 'utf8'}));
}
global.SliceView = function () {};
vm.runInThisContext(cp.execFileSync('git',
  ['show', process.env.REV + ':js/view-physics.js'], {encoding: 'utf8'}));
const w = new Physics4.World4({gravity: 20, restitution: .45, friction: 1.5});
PhysicsView.prototype.resetScene.call({world: w, maxBodies: 8});
for (let i = 0; i < 5000; i++) {
  const before = JSON.stringify(w.bodies), start = performance.now();
  try { w.step(.002); }
  catch (e) {
    console.log({
      revision: process.env.REV, step: i, time: i * .002,
      error: e.message, subdivisions: w._solverSubdivisions,
      failedStepMs: performance.now() - start,
      rolledBack: JSON.stringify(w.bodies) === before
    });
    break;
  }
}
NODE
done
```

旧版同样在索引 133 失败，残差 `2.4377663725388114e-9`，因此不能声称这一参数组合是修复才首次弄坏的。新版的 `rolledBack` 为 `true`。另一次无 JSON 快照计时的串行对照：

| 版本 | 已推进模拟时间 | 到异常的总真实耗时 | 失败的单次 `step` |
|---|---:|---:|---:|
| `dc958a1` | 0.266 s | 3.127 s | 158.5 ms |
| `b08f1f0` | 0.266 s | 5.327 s | 3579.9 ms |

同一个仍然失败的调用慢约 **22.6 倍**。其他重复实验中新版失败调用曾达到 **10.85 s**。机器有共享负载，不把某一次毫秒数当成硬件无关指标；但数秒同步占用 JS 主线程不是细微噪声。在浏览器中，进入错误处理、显示提示、响应复位按钮都必须等待这一同步调用返回。

**八层究竟怎样耗尽：** 对 `advanceWorld` 入口做纯观察性的内存插桩，本例一次外层调用内共尝试 12 次积分，深度依次为：

```text
0, 1, 2, 3, 4, 5, 5, 6, 6, 7, 8, 8
```

最小步长已经是 `.002 / 256 = .0000078125 s`，仍未达到 `1e-12` 的接受条件，最后抛出异常。某些前半步成功不意味着外层可以部分提交；本例所有物体最终确实恢复到原外层步首。

`_solverSubdivisions` 是**发生过几次分裂的计数**，不是最大递归深度，也不是全局“最多重试八次”。深度最多八，完整二叉树最多可有 511 次积分尝试、255 次分裂；每次严格求解还可能续算到 32768 轮，冲击传播另有 64 轮上限。人工让每次 `solveWorld` 都抛错时只走最左路径的 9 次尝试/8 次分裂，现有耗尽测试不能代表所有失败路径的成本。

细分只在 `ContactConvergenceError` 时发生；其他错误恢复状态后直接重新抛出。达到深度八也不接受失败结果、不把残差改小、不悄悄跳过这一步。这部分错误语义是正确的，**问题是修复后合法 UI 输入仍到达这里，而且没有主线程工作量上限**。

**为什么六十组新测试没抓住：** 网格的摩擦只取 `[0,.3,.6,1]`，没有覆盖滑块上限 1.5；时间步只取 `1/240,1/125,1/60`，没有覆盖 2 ms；重力固定用 `World4` 默认的 9.81，没有覆盖 20。甚至 `1/60≈16.667 ms` 不是滑块允许的最大 16 ms。测试扩大了样本，但“覆盖所有合法控件组合”的解释不成立。README 顶部实际列出了离散集合，后文也否认任意接触的全局收敛保证，**不把它误引成真的承诺了整个连续参数域**；A01 的依据是可达故障，而非仅凭网格不全。另一个合法反例是 `g=20,e=.5,μ=1.49,dt=.002`，在 0.282 s 失败。

**建议：** 保存上述真实失败轨迹，按控件实际范围增加边界/组合测试；把接触停滞与时间积分误差分开处理，验证停滞状态的约束解，而非继续依赖缩短时间步自然解困。给重试树和单帧总工作量明确预算，在工作量耗尽时及时提供可恢复反馈。不能用放松 `1e-12`、吞异常或回滚后冒充推进成功来“解决”。若短期只能限制参数域，应同步约束控件并明确说明，而不是继续宣称全修复。

### A02 · F15 的“物体 ROI”仍可由辅助几何通过；物体和截面全部不画也验收成功 — 低

**位置：** `tools/render-probe.js:188–216`、`tools/verify-render.js:131`；相关声明 `README.md:61–64`。这是**验证假阳性/修复只完成一部分**，不表示当前未变异的生产界面已经漏画。

F15 原来会被标题/HUD 像素冒充渲染内容。新版本排除了文字并增加 `draw()` 全停的负对照，这是真正的改进；但“非文字像素”仍然不等于“目标物体存在”。联动页的 H 窗口、相机轴等辅助线也落在 ROI。

**我如何独立确认：** 在 `b08f1f0` 隔离副本中，只去掉 `LinkedView.drawOverview` 的盒体轮廓绘制和实际截面绘制，保留 H 窗口、相机轴和文字。实际运行新的浏览器验收：

```text
tools/verify-render.js --require-browser --probe-only
29 项语义检查仍全部 PASS
linked 物体 ROI：478 pixels
退出码：0
```

两个替换都要求原字符串恰好出现一次，不是替换没生效。移除的是正常运行时的两段绘制调用，而不是 CPU 几何或测试读数；因而 CPU 几何仍对、画面漏物体的真实接线回归恰好会被放过。

可运行的隔离复现如下。需要 Chromium/工具已支持的浏览器；只写系统临时副本，结束后删掉本实验创建的目录：

```sh
node <<'NODE'
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'4d-audit2-'));
try {
  cp.execFileSync('tar',['-x','-C',tmp],{
    input:cp.execFileSync('git',['archive','b08f1f0'])
  });
  const file=path.join(tmp,'js/view-linked.js');
  let src=fs.readFileSync(file,'utf8');
  for(const [before,after] of [
    ['this.meshes.forEach(function (mesh, i) { lines(mesh, colors[i], 1, 0.32); });',''],
    ['state.sections.forEach(function (mesh, i) {','[].forEach(function (mesh, i) {']
  ]){
    if(src.split(before).length!==2)throw Error('Mutation target mismatch: '+before);
    src=src.replace(before,after);
  }
  fs.writeFileSync(file,src);
  const r=cp.spawnSync(process.execPath,
    ['tools/verify-render.js','--require-browser','--probe-only'],
    {cwd:tmp,encoding:'utf8',timeout:900000,maxBuffer:16*1024*1024});
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
  console.log('Probe exit:',r.status);
  if(r.error)throw r.error;
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
NODE
```

**建议：** 增加上述“只删目标物体、保留其他绘制”的负对照，而不只把整个 `draw` 关掉。按目标对象/区域/材质验证预期几何确实参与绘制，或使用确定姿态的对象掩码；H 窗口和相机坐标轴应单独分类。同步收窄 README 的“物体存在性”表述，不能把 ROI 中有任意非文字像素等同于物体存在。

## 三、指定的六项物理性质：审过，未发现回归

除了重跑现有测试，还把两个版本的源码分别载入独立 Node 进程，用手写六分量固定原点角动量、惯性解析矩阵、三维主轴欧拉 RK4 参考轨迹比较。未使用“让新版读数和新版同源读数相等”代替外部约束。

| 性质及确认方式 | `dc958a1` | `b08f1f0` | 判断 |
|---|---:|---:|---|
| 盒子 `m=3,h=[1,2,3,4]` 六个对角值 `[5,10,17,13,20,25]`；超球 `m=3,r=2` 为 `4I₆`；全部 36 项检查 | 最大误差 0 | 0 | 无回归 |
| 三维退化：`I=[13,10,5]`，120 s，每个 `1/240 s` 时刻与独立 `1/960 s` 三维 RK4 比较 | 最大轴向角速度差 `7.213e-9` | 同值 | 不是只查一个局部导数；w 分量始终为 0 |
| 非等边盒子 120 s 自由翻滚，世界六分量 L 的最大相对漂移 | `6.712e-12` | 同值 | 无回归 |
| 同一自由翻滚的动能最大相对漂移 | `2.360e-11` | 同值 | 无回归 |
| 非等边盒子等倾双旋转，120 s，最大 `‖Δω‖` | `9.024e-12` | 同值 | 无回归 |
| 1000 个独立构造的双体瞬时冲击，最大 `‖ΔP‖` / `‖ΔL‖`，L 包含质心轨道项和全部六个自旋分量 | `1.538e-15 / 2.861e-15` | `1.986e-15 / 2.384e-15` | 浮点舍入量级，不能称为显著精度下降 |
| 同一组 6000 对盒子的 GJK / 56 轴 SAT | 2185 相交、3815 分离，零不一致 | 完全相同 | 无回归 |

还补查了**不沿盒体主平面的等倾 ω**：把 `[.7,0,0,0,0,.7]` 用一个非平凡 SO(4) 共轭后作为本体系角速度，非等边盒子 120 s 的最大漂移 `1.501e-11`。不是只验证等方超球这个容易的特例。

现有更广泛的非中心、多点接触测试给出 `max‖ΔP‖=3.770e-15`、`max‖ΔL‖=9.025e-15`；无摩擦弹性动能误差最大 `1.265e-12`。F17 原始共面反例现在会传播至少两轮冲击，所有测试接触最终不再接近；`μ=0` 与 `μ=1e-20` 不再出现第一轮指出的有限能量跳变。它改变了响应实现，不是只删掉旧测试。

可直接复核：

```sh
node test/physics4.test.js
node test/collide4.test.js 'F17 coplanar'
node test/collide4.test.js 'off-center'
node test/collide4.test.js 'frictionless restitution'
node test/collide4.test.js '6000 random'
node test/collide4.test.js 'F16 rollback'
node test/collide4.test.js 'F16 exhausted'
```

`physics4.test.js` 17 项通过。完整碰撞套件执行至原主体 23 项通过后，本轮主动停止了后面的六十组长网格，改为针对性的十秒对照与控件边界实验；**没有声称本轮跑完了整个碰撞套件**。额外单独跑过 `e=.45,μ=.6,dt=1/125` 的十秒网格项，通过。该网格的一项通过不用于否定 A01。

三维逐点独立参考可这样重跑，切换 `REV` 比较修复前后：

```sh
REV=b08f1f0 node <<'NODE'
const cp=require('child_process'),vm=require('vm'); global.window=global;
for(const f of ['m4','physics4']) vm.runInThisContext(cp.execFileSync(
  'git',['show',process.env.REV+':js/'+f+'.js'],{encoding:'utf8'}));
const b=new RigidBody4({mass:3,halfSize:[1,2,3,0],
  angularVelocity:[.7,-.4,0,.9,0,0]});
let w=[.9,.4,.7],max=0,leak=0;
const f=([x,y,z])=>[5*y*z/13,-8*z*x/10,3*x*y/5];
const add=(a,b,h)=>a.map((x,i)=>x+h*b[i]);
function rk(h){
  const a=f(w),b=f(add(w,a,h/2)),c=f(add(w,b,h/2)),d=f(add(w,c,h));
  w=w.map((x,i)=>x+h*(a[i]+2*b[i]+2*c[i]+d[i])/6);
}
for(let i=0;i<28800;i++){
  b.step(1/240,0); for(let j=0;j<4;j++)rk(1/960);
  const a=[b.angularVelocity[3],-b.angularVelocity[1],b.angularVelocity[0]];
  max=Math.max(max,Math.hypot(...a.map((x,i)=>x-w[i])));
  leak=Math.max(leak,Math.hypot(...[2,4,5].map(i=>b.angularVelocity[i])));
}
console.log({maxEulerDifference:max,wPlaneLeakage:leak});
NODE
```

## 四、F03：没有发现把停滞换成穿透或虚假推进

**已审位置：** `js/scene4.js:180–241`。新的二阶下界不是无条件把步长放大：在半径变化受限的区间使用管状距离函数的负曲率下界，同时保留全局 1-Lipschitz 的安全步长。原来的三组种子 `51/42/20260928`、第一轮的小位移反例、精确相切出发以及分成 1/20/50 步的路线都通过。

我另外用种子 `9420928` 对两个非凸原语生成小位移，得到 **32363** 个合法起点的移动：零异常，最小终点余隙 `4.158e-7`。为防“终点安全但中途穿过去”的漏测，又在内存中只记录 `move` 真正走过的每一条分段，不改变推进计算；种子 `7282026` 的 **8124** 条路线，每段取 101 个点检查，最小路径余隙 `2.311e-7`，最大额外路程只有 `8.882e-16`。

```sh
node test/scene4.test.js '400 seeded'
node test/scene4.test.js 'F03 small'
node test/scene4.test.js 'exactly touching'
```

本轮完整 `scene4.test.js` 30 项也通过。随机采样不是连续安全性的形式化证明，但结合下界推导，**没有证据支持“F03 只是换了一种失败方式”**，不为凑数列发现。

## 五、十秒物理性能实测

### 方法与结果

同一机器、同一 Node、同一真实 `PhysicsView.resetScene()` 六体、同一物理参数和模拟步数；历史源码通过 `git show` 读入，不 stash，不切换工作区。时间从建好场景后到完成十秒模拟为止，不含源码加载，不含渲染。各版本串行跑；有共享机器负载及其他审查诊断，未做 CPU 绑核或稳态微基准，因此保留原始数值，不夸大百分比精度。

**这测的是物理页签的 CPU 模拟成本，不是浏览器渲染帧率或 GPU 时间。** 主线程同步重试的延迟另由 A01 的实际 app 接线确认。

| 场景，重力除注明外为实际 UI 的 9.8 | `dc958a1` 真实秒 | `2ff7b21` 真实秒 | `b08f1f0` 真实秒 |
|---|---:|---:|---:|
| 默认六体，`e=.45,μ=.6,dt=.004`，模拟 10 s | 100.829 | 49.680 | 55.745 |
| 同六体，无摩擦，`e=.45,μ=0,dt=.016`，模拟 10 s | 11.135 | 未重复 | 4.661 |
| 六体隔开 100 单位、无地板/重力，`dt=.004`，模拟 10 s | 1.157 | 未重复 | 1.059 |
| 默认六体，`e=0,μ=1.5,dt=.016` | 在 0.304 s 失败；此前耗时 5.246 s | 未重复 | **10 s 完成**，20.746 s |
| 默认六体，`e=0,μ=0,dt=.004` | 在 0.336 s 失败；此前耗时 4.617 s | 未重复 | **10 s 完成**，39.206 s |
| 默认六体，`e=.01,μ=1.5,dt=.016`，模拟 10 s | 未测 | 未重复 | 17.598 |

不能把“旧版几秒就报错退出”当作“旧版更快地完成十秒”。这些失败项没有可比的十秒完成耗时。

**结论：没有发现默认场景变慢，反而明显更快；无接触场景也未发现显著回归。** 新版默认场景的成功严格求解累计轮数从旧版约 237361 降到 71600，`2ff7b21` 与 `b08f1f0` 的累计轮数和两次细分完全相同。后两者 49.680/55.745 s 的差别不能解释为源码回归，因为三个相关物理文件逐字相同。

后续再串行重复一次默认十秒对照，旧版 **67.112 s**、新版 **21.515 s**，求解轮数仍各为 237361/71600。绝对耗时随共享负载明显变化，**两次对照的方向一致**；因此不把首次 100.829/55.745 的比例当作稳定性能倍数。

**实测最糟糕的新成本在失败重试路径，而不是默认参数：** A01 的 `g=20,e=.45,μ=1.5,dt=.002`，同一模拟时刻仍然失败，但一次调用从约 0.159 s 放大到 3.580 s；它无法完成要求的十秒。这是需要修的性能/可响应性问题。高摩擦并不总是最慢：`e=0,μ=1.5,dt=.016` 能迅速稳定；`e=0,μ=0,dt=.004` 则在十秒里经历 23 次分裂。不能给出“摩擦越大一定越慢”的泛化。

### 可运行的对照命令

下面复现默认十秒比较。改变 `e,mu,dt` 即可复查表中其他默认六体行；隔离自由六体的修改也在注释中。

```sh
for rev in dc958a1 2ff7b21 b08f1f0; do REV="$rev" node <<'NODE'
const cp=require('child_process'),vm=require('vm'); global.window=global;
for(const f of ['m4','physics4','collide4']) vm.runInThisContext(cp.execFileSync(
  'git',['show',process.env.REV+':js/'+f+'.js'],{encoding:'utf8'}));
global.SliceView=function(){};
vm.runInThisContext(cp.execFileSync('git',
  ['show',process.env.REV+':js/view-physics.js'],{encoding:'utf8'}));
const e=.45,mu=.6,dt=.004;
const w=new Physics4.World4({gravity:9.8,restitution:e,friction:mu});
PhysicsView.prototype.resetScene.call({world:w,maxBodies:8});
// 自由六体行：取消下一行注释。
// w.floorEnabled=false;w.gravity=0;w.bodies.forEach((b,i)=>b.position=[i*100,0,0,0]);
let i=0,subdivisions=0,error=null,maxStepMs=0;
const start=performance.now();
try {
  for(;i<Math.round(10/dt);i++){
    const t=performance.now();w.step(dt);
    maxStepMs=Math.max(maxStepMs,performance.now()-t);
    subdivisions+=w._solverSubdivisions||0;
  }
} catch(e){error=e.message;}
console.log({revision:process.env.REV,e,mu,dt,simulated:i*dt,
  wallSeconds:(performance.now()-start)/1000,maxStepMs,subdivisions,error});
NODE
done
```

## 六、其他已审且认为没问题的修复

这些结论不只来自“新测试绿了”：还审查实际接线，并做独立数学或真实 Chromium DOM/布局实验。

| 第一轮条目 | 这次如何确认 | 结论 |
|---|---|---|
| F01 等倾按钮 | `js/view-projection.js:63–76` 保留旧姿态，应用新的固定等倾增量；真实按钮前后姿态差 0，增量对称部分离等倾条件的误差 `1.11e-16` | 改了根因，没有只改滑块显示 |
| F02 自转开关 | `js/view-analogy.js:127–147` 分开扫描时间/姿态时间；真实 checkbox 后截获 A/B/C/D 四组实际材料坐标，全部不再转；重新开启扫描时 k 变化而材料不动 | 改了根因 |
| F04 红球教程 | `js/view-slice.js:226–242`、`js/app.js:233–238` 提供安全、正对红球的预设，关闭会误导的染色/X 光并释放按钮焦点；320/390/桌面视锥、CPU 遮挡和真实 E 输入均通过；生产浏览器探针的红球像素断言也通过 | 预设/输入及既有像素探针闭环；另一个独立 GPU 红球实验未完成，见不确定项 |
| F05 DPR/四格布局 | 真 Chromium：320 宽及 390 宽 DPR3 时 CSS 画布高 1200，每格 300，最小字体 12 CSS px；桌面 DPR2 正确；990/1000/1010 宽断点和重复 resize 无错配，`pan-y` 生效 | 改了坐标/布局根因 |
| F06 退化截面 | `js/section.js:4–51` 被两个入口实际共用；独立“原盒棱枚举 + 共同活动胞面的秩”判邻接，7238 个截面顶点数/边数/维数全同，最大切面残差 `8.88e-16` | 没发现共享提取引入的几何回归 |
| F07 旋转/投影错误文案 | 简单旋转与双旋转、原点与整周例外、投影不保距离/拓扑、两级降维只是设计选择逐项核对；`js/m4.js` 此次只改注释，不改运算 | 正确纠错 |
| F08 错误截面描述 | 直接按原语方程独立核算双圆柱、球环面、虎环，边界残差约 `1.2e-15`；实际 zw=π/2 相机法向为 −z，能看到所述环面截面 | 正确纠错 |
| F09 教学/可见性过强声明 | 七层仅采样、理想截面与有限射线误差、三维成像超平面与人眼视网膜、有限墙与封闭牢房的区别都已限定；w=0、y=2.851 确能从墙上方绕过 | 没有新的数学必要性/学习效果承诺 |
| F18 “重力零就自由翻滚” | 页面现在要求无碰撞、无外力矩的自由阶段；gravity=0 不会关掉 `floorEnabled`，文案不再暗示相反 | 文案与代码一致 |

复核现有入口：

```sh
node test/views.test.js
node test/scene4.test.js 'F01/F02'
node test/scene4.test.js 'F04 tutorial'
node test/scene4.test.js 'F08 parallel'
node test/scene4.test.js 'box sections'
node test/scene4.test.js 'tilted hyperplanes'
node test/scene4.test.js 'F16/F03 runtime'
```

真实布局和独立截面实验比这些现有断言更广；它们不证明所有设备/所有几何输入都正确。在这个范围内，**没找到确定的新生产 UI/几何缺陷**。

## 七、README 新增声明的核对

按本次 diff 的语义组列出，不把同义句的多次出现当作多份独立证据。数字验收与变异测试的专门结论另列后文。

| 当前 README 位置 | 新增/收窄的声明 | 核对结果 |
|---|---|---|
| `3,80–90` | 可控投影/切片是目标；两级降维非数学必要；教学分工非效果保证 | 一致 |
| `15–20` | F01/F02/F04/F05/F06 修复摘要 | 与实现一致；F03 另见第四节，未发现回归 |
| `30–33` | P2 的四条纠错摘要 | 编号确为 F07/F08/F09/F18；不是 F10 |
| `95–125` | 简单/双旋转、原点、固定等倾增量、Gram–Schmidt 只减漂移 | 一致 |
| `142–152,177` | 正交投影有损；立体投影去极点，分母钳制/省略长棱是显示保护；Hopf 精确对象与折线显示区分 | 一致 |
| `185–208` | 第一人称成像约定；理想截面还要作二维透视，并受有限射线步数/容差影响 | 一致 |
| `237–242` | 定向参照是选择；不混 y 的四维转身不改地板法向；未验证眩晕效果 | 一致 |
| `253–271` | 各形状的截面、球环面旋转后的方程与安全相机、没有 π/2 键盘吸附 | 独立方程及实际相机核对一致 |
| `274–276,328–329` | 有限墙有其他绕行路线；世界 w 位移未必离开当前成像超平面；材料本身不形变 | 一致 |
| `361–374` | 类比是假说；七层是样本；共享求交限于凸平面面片并返回退化元数据 | 与共享核心及独立截面结果一致 |
| `51–52,407` | 主射线命中/推进/终止表达式单源；软阴影独立 | 实现确实如此，不只是把常数移到一起 |
| `634–646` | 同一 e 的无外力接触组能量式、至多 64 次冲击传播、摩擦零/趋零共用冲击阶段、e=0 热启动 | 条件写得比第一轮严谨；原 F17 数值反例已修；不能把单组冲击的公式扩大为任意整步能量证明 |
| `650–670` | 缓存 J、最多七个历史状态、每八轮尝试 Anderson、真实残差下降才接受、32768 求解预算、最多八层、失败回滚并报错 | 对严格的多体接触求解路径与代码一致；A01 实证说明“有护栏”不等于合法参数永不失败。八层也不是八次总尝试 |
| `691–695` | 六十组十秒扫描、注入回滚/复位测试、F17 碰后法向速度检查 | 对应测试确实存在；本轮未重跑全部六十组，不背书历史运行结果；其中 `1/60` 超出滑块最大 16 ms，“合法参数”若指 UI 域则用词不精确 |
| `908` | VR 仍显示选定的三维切片；假想成像超平面不是人的视网膜 | 一致 |

`index.html` 对应的新限定、教程步骤、共享脚本依赖也检查过，没有找到独立于已列发现的新矛盾。`docs/math/representations.md` 把旧测试表/旧依赖失败标为历史，这个修订消除了时间语境混淆。

**没有发现为了修复 F01–F09/F16–F18 而删掉原有正确物理或几何断言的证据。** F14 的数值预算与整个变异验收不能据此顺带判定，见专门核对。

## 八、变异套件与七条 P3：不是空洞通过，但不是完整覆盖证明

### 基线、执行与失败归因

实际七条 P3 是 **F10–F15、F19**，F18 是 P2。`test/mutation.test.js:10,16–24,126–158` 读取 `2ff7b21` 的真实 Git 对象，比较的是 P1 已修、P3 尚未补强的版本。该提交没有修改 `math4`/`rings4` 测试；其他相关测试也不是人为还原的一份“弱旧测试”。**作为这些 P3 的旧测基线是正确的，作为物理修复前基线则不正确。**

实际审读并执行确认了：变异目标唯一匹配、两边未变异正对照、旧测必须真的通过、新测必须按指定失败证据失败、每项恢复修改、拒绝跳过/零测试/无关异常。完整隔离运行最终输出：

```text
25 mutation cases passed, 0 failed
```

退出码 0。最初一次浏览器尝试因临时目录路径太长触发 Chromium `Socket path too long`；修正隔离运行环境后从头重跑，**没有把那个环境失败计为成功杀死变异**。既有 25 项中，没有确认“变异没生效却算成功”或“由无关异常代杀”的空洞通过。A02 是另加负对照发现的遗漏，不是这 25 项里某项执行造假。

### 二十五项覆盖在哪里

| 第一轮条目 | 项数 | 实际内容及本轮判断 |
|---|---:|---|
| F10 | 1 | GLSL 命中 epsilon 放大 100 倍，真实浏览器解析射线断言抓住；共享 ray AST 消除了原双写。**闭环** |
| F11 | 1 | 第三段证书 bound 改成 999 被抓住；`test/rings4.test.js:41–53` 检查返回证书、独立距离及分段边界，`test/scene4.test.js:545–552` 检查真实页面 bound/gap。**闭环** |
| F12 | 10 | 正交投影常值、xz 旋转恒等、八个基础 API 抛错全部被抓住；`test/math4.test.js:528,771–809` 新增全部六个旋转平面及基础 API 的直接契约。**闭环** |
| F13 | 3 | 四条纤维用同一种子、反向拖动、遗漏显示相机逆变换均被抓住；`test/math4.test.js:692–698,740–754` 不再用被测导出数据直接当期望。**闭环** |
| F14 | 1 | 合法种子应通过；恢复旧 Gram 期望应失败；故意把标架弄错 `1e-12` 也必须失败。是误报预算的反向验收，**不是普通错误实现变异**。原反例闭环 |
| F15 | 2 | 缺联动右图 draw、投影只剩背景/图例均被抓住；画布枚举及右图变化有效，但漏掉 A02。**部分闭环** |
| F19 | 7 | shape/radius/floor 上传、shader 实际消费 shape/size/floor、前置脚本缺失被抓住；`test/collide4.test.js:573–579,613–619` 与 `tools/render-probe.js:159–185` 一起覆盖 CPU 接线和真实 shader。**闭环** |

所以不是只覆盖七条中的两三条，但分布明显偏斜：**F12 占 40%，F19 占 28%**；F10/F11 各只有一个变异，F15 只有两个且存在已实证盲点。精确称呼应是 **24 项错误实现变异 + 1 项 F14 误报验收**，不能把“25/25”解释成每个修复都经过广泛独立破坏。

### 实际删松一条断言：变异测试真的会失败

我在隔离副本中**只删除** `test/math4.test.js:754` 的真实新增断言，其他实现和变异套件不动：

```js
vectorNear(demo.state[side], unit(qmul(expectedDelta, oldState)),
  5e-16, 'F13 actual drag direction and display inverse');
```

再运行 `node test/mutation.test.js F13`：

```text
1 mutation cases passed, 2 failed
FAIL F13 reverse pointer drag
Error: Mutation survived or failed for an unrelated reason
14 passed, 0 failed; 1886354 assertions; seed=1293952521

FAIL F13 omit inverse display camera
Error: Mutation survived or failed for an unrelated reason
14 passed, 0 failed; 1886365 assertions; seed=1293952521

Observed mutation suite exit: 1
```

这正是期望行为：删断言后两个错误实现重新通过数学测试，**变异套件发现它们存活并报失败**。不是因为别的异常导致“变异被抓住”。这一项实际自检支持机制可信，不证明删除任意其他断言都必然被发现。

以下命令可独立重做删除实验，不修改仓库：

```sh
node <<'NODE'
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const gitDir=cp.execFileSync('git',['rev-parse','--absolute-git-dir'],
  {encoding:'utf8'}).trim();
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'4d-audit2-drag-'));
try {
  cp.execFileSync('tar',['-x','-C',tmp],{
    input:cp.execFileSync('git',['archive','b08f1f0'])
  });
  const file=path.join(tmp,'test/math4.test.js');
  const src=fs.readFileSync(file,'utf8');
  const target="    vectorNear(demo.state[side], unit(qmul(expectedDelta, oldState)), 5e-16, 'F13 actual drag direction and display inverse');";
  if(src.split(target).length!==2)throw Error('Expected one regression assertion');
  fs.writeFileSync(file,src.replace(target,''));
  const r=cp.spawnSync(process.execPath,['test/mutation.test.js','F13'],{
    cwd:tmp,env:{...process.env,GIT_DIR:gitDir,GIT_WORK_TREE:tmp},
    encoding:'utf8',timeout:900000,maxBuffer:16*1024*1024
  });
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
  console.log('Observed mutation suite exit:',r.status);
  if(r.error)throw r.error;
  if(r.status!==1||!(r.stdout||'').includes('1 mutation cases passed, 2 failed'))
    throw Error('Expected assertion-weakening detection did not occur');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
NODE
```

### F14 是改测试，但没有找到“把错实现放过去”的证据

`test/math4.test.js:463–465` 的确改了断言；只凭“改测试”三个字不能判假修复。旧断言把浮点归一化后的 q 当作长度**精确**为 1；新版本先单独要求输入平方范数误差不超过 `4*Number.EPSILON`，再检查对这个输入数学上正确的 `Gram=‖q‖²I`。标架等式的原 **`7e-16`** 判据未放松。

合法种子 `3872508113` 实际通过；恢复旧期望会重现误报；错误标架加 `1e-12` 仍被拒绝。另对同一归一化过程采样 500 万个 Gaussian 输入，最大平方范数误差 `7.772e-16`，没有越过新的 `8.882e-16` 输入预算。这是额外经验检验，不是浮点误差的普遍形式化证明。

**本轮不把 F14 列成假修复。** 它修的是测试错误的精确输入假设，而不是统一扩大容差、换一个碰巧通过的固定种子。

### 测试/工具新声明的剩余核对

| 声明位置 | 核对结果与界限 |
|---|---|
| `README.md:35–49`：旧 Git 对象、正对照、定向失败、25 项验收 | 机制和完整 25 项实跑一致；25 的组成及不均衡分布见上 |
| `README.md:53–55`：六条固定射线、CPU/GPU `5e-5`、动态 SDF `3e-5` 与量化 | 浏览器探针及相关变异确实执行并通过；只约束选定射线/动态字段，不是所有视角误差界 |
| `README.md:57–59,74` 与 `docs/math/representations.md:890–894`：F14 输入预算、原判据不放宽、数学 14 组 | 与代码和种子实跑一致；未发现隐藏实现错误的放宽 |
| `README.md:61–65,71–73`：8 画布、29 语义、ROI 负对照、176 常规/25 变异 | 8 画布/29 语义的生产探针实际通过；**ROI 物体存在性声明受 A02 反例限制**。176 注册数为 `17+83+30+11+17+4+14`，不是本轮全部 176 项重跑通过 |
| `README.md:67–69,523–535,550–552`：命令、Node 22+/Chromium、无 npm 依赖、缺浏览器行为 | 实际工具路径可运行；环境错误/跳过没有被变异验收当作通过 |
| `README.md:856,877–879`：rings 17 项、显示下界、浏览器负对照与 1×1 诊断 | 注册数和相应显示/探针约束一致；不存在 29 个独立 GPU 场景的额外证据 |

**29 是检查条数，不是 29 个独立 GPU 场景：** 18 条 F10、10 条 F19、1 条 F15，包含 CPU 及 CPU/GPU 比较。八块画布是七个页签加上联动页的第二块画布。

未变异 `b08f1f0` 的 `--require-browser --probe-only` 正对照实际通过，包括红球像素断言；没有打印原始 RGB，本文不补造数值。**本轮没有单独重跑 b08 包含全部布局阶段的完整 `verify-render --require-browser`**：当前布局的独立证据来自真实 CDP 实验，完整变异流程中的旧渲染对照则属于 `2ff7b21`。两者不混写成一次不存在的全套运行。

## 九、我不确定的部分

- **F16 的收敛理论与全域最坏耗时。** 找到了真正耗尽八层的默认六体反例，但没有证明所有停滞都来自同一种原因，也没有求出滑块连续参数域的全局最坏组合。本文“最糟糕”只指本轮实测。残差的量纲/绝对阈值对极端质量比的适用性不在已有实验的证明范围内。
- **F03 对所有连续路径的严格安全性。** 下界推导、旧反例和额外路径采样支持修复有效；8124 条路径的离散采样不是形式化证明，也未穷举任意自定义多个非凸物体夹住相机的情形。
- **GPU、浏览器与真机范围。** UI 几何/交互有真实 Chromium DOM 和布局证据，但另一项独立红球 `readPixels` 实验在 64×84 与 1×1 下都遭遇 CDP `Runtime.evaluate` 90 s 超时；没有把它计作通过，也没有把环境超时凭空定位成产品缺陷。未在真实手机上验证触摸体验或做人工全画面复核。
- **性能的绝对数值。** 使用共享 Linux 环境，报告原始真实耗时；没有把不同进程启动/JIT/系统负载差别解释为微小源码性能变化，也没有从 Node 模拟耗时直接推导用户设备帧率。A01 同步重试导致长时间不能返回这一事实不依赖 GPU。
- **完整历史验收。** 本轮未跑完所有六十组物理网格，不能独立证明 README 中“共六百秒全过”的历史记录；这与已经独立复现出其网格以外的合法 UI 故障并不矛盾。

## 十、对“19 条已全部修复”的最终判断

十九条均逐项核对了实际改动：**F15、F16 只能算部分闭环，其余原报告的具体反例/错误声明在本轮覆盖内得到修正。** 没有确认第三条独立问题；没有发现指定的物理守恒性质、F03 安全推进或既有 25 项变异执行本身的新回归。

若必须选一个**最像“假修复”**的条目，我选 **F15 的“物体存在性验收”**：原本由标题/HUD 充当物体证据，现在标题不能骗过它了，但辅助窗口/坐标轴仍然能；核心的“目标物体到底画出来没有”尚未建立可靠判据。不是指整个 F15 完全没改进，也不是说变异套件造假。

F16 更准确的评价是**真实改进、尚未修全，并引入昂贵的失败路径**：旧默认参数问题大量缓解，回滚和复位确实有效，六项物理性质也保持；但 A01 的合法六体场景仍然失败，不能接受“全部修好”的总括结论。

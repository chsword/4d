'use strict';

// Mutate isolated copies, never the working tree. The immutable P1 baseline
// supplies the actual old assertions, not a weakened reconstruction of them.
// GPU cases use the existing zero-package Chromium runner and MUST NOT skip.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), BASE = '2ff7b21';
const filter = process.argv[2] || '';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), '4d-mutations-'));
let passed = 0, failed = 0;

function git(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }); }
function snapshot(dir, baseline) {
  const ref = baseline === true ? BASE : baseline;
  const files = baseline ? git(['ls-tree', '-r', '--name-only', ref]).trim().split('\n')
    : git(['ls-files', '--cached', '--others', '--exclude-standard']).trim().split('\n');
  for (const file of files) {
    if (!/^(js\/|test\/|tools\/|proto\/|index\.html$)/.test(file) || !/\.(js|html|css)$/.test(file)) continue;
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, baseline ? git(['show', ref + ':' + file]) : fs.readFileSync(path.join(ROOT, file)));
  }
}
function replace(dir, file, before, after) {
  const target = path.join(dir, file), text = fs.readFileSync(target, 'utf8');
  if (text.split(before).length !== 2) throw new Error('Mutation must match exactly once: ' + file + ': ' + before);
  fs.writeFileSync(target, text.replace(before, after));
  return function () { fs.writeFileSync(target, text); };
}
function run(dir, args, env) {
  const result = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8',
    timeout: 900000, maxBuffer: 16 * 1024 * 1024,
    env: Object.assign({}, process.env, { MATH4_SEED: '1293952521' }, env) });
  if (result.error || result.signal) throw result.error || new Error('Child terminated: ' + result.signal);
  const output = result.stdout + result.stderr;
  if (/\bSKIP\b/.test(output)) throw new Error('Skipped checks are not mutation evidence\n' + output);
  return { status: result.status, output };
}
function success(result, label) {
  if (result.status !== 0 || !/\bPASS\b/.test(result.output)) throw new Error(label + '\n' + result.output);
}
function killed(result, evidence) {
  if (result.status === 0 || !result.output.includes('FAIL') || !evidence.test(result.output)) {
    throw new Error('Mutation survived or failed for an unrelated reason\n' + result.output);
  }
}
const gpu = (id) => ['tools/verify-render.js', '--require-browser', '--only=' + id];
const cases = [
  { id: 'F10', name: 'GLSL hit epsilon x100',
    oldArgs: ['test/scene4.test.js'], args: gpu('F10'), evidence: /F10 GPU analytic ray/,
    mutate(dir, old) {
      return old ? replace(dir, 'js/view-slice.js', '0.0018 * max(t, 1.0)', '0.18 * max(t, 1.0)')
        : replace(dir, 'js/scene4.js', 'emit(ray.hit)', "emit(ray.hit).replace('0.0018', '0.18')");
    } },
  { id: 'F11', name: 'stage-three bound = 999',
    oldArgs: ['test/rings4.test.js'], args: ['test/rings4.test.js', 'F11'], evidence: /F11 returned analytic certificate/,
    mutate(dir) { return replace(dir, 'js/rings4.js', 'var bound = stage === 1 || omitTranslation ?',
      'var bound = !omitTranslation && stage === 3 ? 999 : stage === 1 || omitTranslation ?'); } },
  { id: 'F12', name: 'orthographic projection becomes constant',
    oldArgs: ['test/math4.test.js'], args: ['test/math4.test.js'], evidence: /orthographic coordinates/,
    mutate(dir) { return replace(dir, 'js/m4.js', 'return [v[0], v[1], v[2], 1];', 'return [0, 0, 0, 0];'); } },
  { id: 'F12', name: 'xz rotation becomes identity',
    oldArgs: ['test/math4.test.js'], args: ['test/math4.test.js'], evidence: /all plane basis actions xz/,
    mutate(dir) { return replace(dir, 'js/m4.js', 'function rotation(plane, angle) {',
      "function rotation(plane, angle) { if (plane === 'xz') return ident();"); } },
  ...['compose', 'dot', 'len', 'scale', 'add', 'sub', 'normalize', 'orthonormalize'].map((name) => ({
    id: 'F12', name: 'M4.' + name + ' throws',
    oldArgs: ['test/math4.test.js'], args: ['test/math4.test.js'], evidence: new RegExp('broken M4\\.' + name),
    mutate(dir) {
      const text = fs.readFileSync(path.join(dir, 'js/m4.js'), 'utf8');
      const signature = text.match(new RegExp('function ' + name + '\\([^)]*\\) \\{'))[0];
      return replace(dir, 'js/m4.js', signature, signature + " throw Error('broken M4." + name + "');");
    }
  })),
  { id: 'F13', name: 'all four fiber seeds coincide',
    oldArgs: ['test/math4.test.js'], args: ['test/math4.test.js'], evidence: /F13 independent Hopf base/,
    mutate(dir) { return replace(dir, 'proto/math/spin-atlas.html', 'var seeds = bases.map(section);',
      'var seeds = bases.map(function(){ return one.slice(); });'); } },
  { id: 'F13', name: 'reverse pointer drag',
    oldArgs: ['test/math4.test.js'], args: ['test/math4.test.js'], evidence: /F13 actual drag direction/,
    mutate(dir) { return replace(dir, 'proto/math/spin-atlas.html', 'deltaBetween(previous, next)', 'deltaBetween(next, previous)'); } },
  { id: 'F13', name: 'omit inverse display camera',
    oldArgs: ['test/math4.test.js'], args: ['test/math4.test.js'], evidence: /F13 actual drag direction/,
    mutate(dir) { return replace(dir, 'proto/math/spin-atlas.html', 'function unspatial(u) {', 'function unspatial(u) { return u;'); } },
  { id: 'F15', name: 'omit linked right draw',
    oldArgs: ['tools/verify-render.js', '--require-browser'],
    args: ['tools/verify-render.js', '--require-browser', '--probe-only'], evidence: /F15 linked right wall disappears/,
    mutate(dir) { return replace(dir, 'js/view-linked.js', 'this.slice.draw();', '/* mutation: omitted right view */'); } },
  { id: 'F15', name: 'projection retains only background and legend',
    oldArgs: ['tools/verify-render.js', '--require-browser'],
    args: ['tools/verify-render.js', '--require-browser', '--probe-only'], evidence: /F15 missing object geometry: projection/,
    mutate(dir) { return replace(dir, 'js/view-projection.js',
      'var verts = this.shape.verts, edges = this.shape.edges;', 'var verts = [], edges = [];'); } },
  { id: 'F15', name: 'linked overview retains helpers but no object outlines or sections',
    baseline: '9b86967',
    oldArgs: ['tools/verify-render.js', '--require-browser', '--probe-only'],
    args: ['tools/verify-render.js', '--require-browser', '--probe-only'], evidence: /F15 missing object geometry: linked/,
    mutate(dir, old) {
      var undoOutlines = replace(dir, 'js/view-linked.js',
        (old ? '' : 'if (!omitObjects) ') + 'this.meshes.forEach(function (mesh, i) { lines(mesh, colors[i], 1, 0.32); });', '');
      var undoSections = replace(dir, 'js/view-linked.js',
        "lines(mesh, selected ? '#6ee7ff' : colors[i], selected ? 2.5 : 1.8, 1);", '');
      var undoTangent = replace(dir, 'js/view-linked.js',
        "if (mesh.verts.length === 1) point(mesh.verts[0], colors[i], '" + (old ? '相切点' : '') + "', 3);", '');
      return function () { undoTangent(); undoSections(); undoOutlines(); };
    } },
  { id: 'F19', name: 'all glomes uploaded as boxes',
    oldArgs: ['test/collide4.test.js', 'six-body demo'], args: ['test/collide4.test.js', 'six-body demo'], evidence: /F19 shape uniform/,
    mutate(dir) { return replace(dir, 'js/view-physics.js',
      "this.shapes[i] = body.shape === 'glome' ? 1 : 0;", 'this.shapes[i] = 0;'); } },
  { id: 'F19', name: 'wrong uploaded radius',
    oldArgs: ['test/collide4.test.js', 'six-body demo'], args: ['test/collide4.test.js', 'six-body demo'], evidence: /F19 exact float32 size/,
    mutate(dir) { return replace(dir, 'js/view-physics.js', '[body.radius, body.radius, body.radius, body.radius]',
      '[body.radius * 2, body.radius, body.radius, body.radius]'); } },
  { id: 'F19', name: 'floor upload moved by one',
    oldArgs: ['test/collide4.test.js', 'six-body demo'], args: ['test/collide4.test.js', 'six-body demo'], evidence: /F19 floor uniform/,
    mutate(dir) { return replace(dir, 'js/view-physics.js', 'gl.uniform1f(this.u.uFloor, this.world.floorY);',
      'gl.uniform1f(this.u.uFloor, this.world.floorY + 1);'); } },
  { id: 'F19', name: 'shader ignores sphere shape branch',
    oldArgs: ['test/collide4.test.js', 'six-body demo'], args: gpu('F19'), evidence: /F19 GPU glome not box corner/,
    mutate(dir) { return replace(dir, 'js/view-physics.js',
      'if (uShape[i] > 0.5) d = sdSphere4(local, uSize[i].x);', 'if (uShape[i] > 2.0) d = sdSphere4(local, uSize[i].x);'); } },
  { id: 'F19', name: 'shader ignores uploaded floor',
    oldArgs: ['test/collide4.test.js', 'six-body demo'], args: gpu('F19'), evidence: /F19 GPU nondefault floor/,
    mutate(dir) { return replace(dir, 'js/view-physics.js', 'vec2 res = vec2(p.y - uFloor, 1.0);',
      'vec2 res = vec2(p.y + 1.5, 1.0);'); } },
  { id: 'F19', name: 'shader ignores anisotropic box size',
    oldArgs: ['test/collide4.test.js', 'six-body demo'], args: gpu('F19'), evidence: /F19 GPU oriented anisotropic box/,
    mutate(dir) { return replace(dir, 'js/view-physics.js', 'float d = sdBox4(local, uSize[i]);',
      'float d = sdBox4(local, vec4(0.6));'); } },
  { id: 'F19', name: 'missing physics prerequisite script',
    oldArgs: ['test/collide4.test.js', 'six-body demo'], args: ['test/collide4.test.js', 'six-body demo'], evidence: /required classic script exists: physics4/,
    mutate(dir) { return replace(dir, 'index.html', '<script src="js/physics4.js"></script>', ''); } }
];

try {
  const before = path.join(temp, 'before'), after = path.join(temp, 'after');
  snapshot(before, true); snapshot(after, false);
  const controls = new Set(), baselines = new Map([[BASE, before]]);
  for (const c of cases.filter((c) => !filter || c.id.includes(filter))) {
    try {
      console.log('RUN ' + c.id + ' | ' + c.name);
      const ref = c.baseline || BASE;
      if (!baselines.has(ref)) {
        const dir = path.join(temp, ref);
        snapshot(dir, ref); baselines.set(ref, dir);
      }
      const old = baselines.get(ref);
      for (const [dir, args] of [[old, c.oldArgs], [after, c.args]]) {
        const key = dir + JSON.stringify(args);
        if (!controls.has(key)) { success(run(dir, args), 'Unmutated positive control failed'); controls.add(key); }
      }
      let undo = c.mutate(old, true);
      try { success(run(old, c.oldArgs), 'Baseline did not let this mutation survive'); } finally { undo(); }
      undo = c.mutate(after, false);
      try { killed(run(after, c.args), c.evidence); } finally { undo(); }
      passed++; console.log('PASS ' + c.id + ' | ' + c.name + ' | before: SURVIVED | after: KILLED');
    } catch (e) { failed++; console.error('FAIL ' + c.id + ' ' + c.name + '\n' + e.stack); }
  }
  if (!filter || filter === 'F14') {
    try {
      const args = ['test/math4.test.js'], env = { MATH4_SEED: '3872508113' };
      success(run(before, args, { MATH4_SEED: '1293952521' }), 'Old default seed');
      // F14 is a false positive, not a surviving broken implementation.
      killed(run(before, args, env), /global orthonormal tangent frame/);
      success(run(after, args, env), 'Correct implementation must accept the legal seed');
      let undo = replace(after, 'test/math4.test.js',
        "vectorNear(gram([q].concat(E)), scale(M4.ident(), normSquared), 7e-16, 'global orthonormal tangent frame');",
        "vectorNear(gram([q].concat(E)), M4.ident(), 7e-16, 'global orthonormal tangent frame');");
      try { killed(run(after, args, env), /global orthonormal tangent frame/); } finally { undo(); }
      // Protect mathematical correctness as well: a genuinely wrong frame
      // must still fail, rather than hiding under a larger global epsilon.
      undo = replace(after, 'test/math4.test.js', 'var q = sphere(4), E = frame(q), h = hopf(q);',
        'var q = sphere(4), E = frame(q), h = hopf(q); E[0][0] += 1e-12;');
      try { killed(run(after, args, env), /global orthonormal tangent frame/); } finally { undo(); }
      passed++; console.log('PASS F14 | legal seed: before FALSE FAIL, after PASS | old budget restored: KILLED | wrong frame +1e-12: KILLED');
    } catch (e) { failed++; console.error('FAIL F14\n' + e.stack); }
  }
  if (!passed && !failed) throw new Error('No mutation cases selected: ' + filter);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('\n' + passed + ' mutation cases passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

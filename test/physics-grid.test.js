'use strict';

global.window = global;
require('../js/m4.js');
require('../js/physics4.js');
require('../js/collide4.js');
require('../js/scene4.js');
require('../js/view-slice.js');
require('../js/view-physics.js');

const assert = require('node:assert/strict');
const filter = process.argv[2] || '';
let passed = 0, failed = 0;

function mechanical(world) {
  return world.bodies.reduce((sum, b) => sum + b.kineticEnergy() +
    b.mass * world.gravity * (b.position[1] - world.floorY), 0);
}

for (const g of [0, 9.8, 20]) for (const e of [0, 0.45, 1]) {
  for (const mu of [0, 0.6, 1, 1.5]) for (const ms of [2, 4, 8, 16]) {
    const name = `F16 slider grid g=${g} e=${e} mu=${mu} dt=${ms}ms`;
    if (filter && !name.includes(filter)) continue;
    const stats = { g, e, mu, dtMs: ms, frames: 10000 / ms, skipped: 0, stopped: 0,
      advancedSeconds: 0, maxStepMs: 0, maxSkippedStepMs: 0, maxWork: 0, maxDepth: 0,
      timeouts: 0, workExhaustions: 0, convergenceFailures: 0 };
    try {
      const view = Object.create(PhysicsView.prototype);
      Object.assign(view, { maxBodies: 8, world: new Physics4.World4({ gravity: g, restitution: e, friction: mu }),
        timeStep: ms / 1000, paused: false, cam: [0, 0.4, 0, 0], yaw: 0, pitch: 0, a_xw: 0, a_zw: 0 });
      view.resetScene();
      const world = view.world;
      for (let i = 0; i < stats.frames; i++) {
        const before = JSON.stringify(world.bodies), contacts = world._collisionContacts;
        const solver = world._solverResult, energy = mechanical(world);
        const start = performance.now();
        try { view.step(view.timeStep); }
        catch (error) { stats.stopped++; throw error; }
        const elapsed = performance.now() - start, result = world.stepResult;
        stats.maxStepMs = Math.max(stats.maxStepMs, elapsed);
        stats.maxWork = Math.max(stats.maxWork, result.work);
        assert(!view.error, 'tab never enters fatal state');
        assert(result.work <= Physics4.STEP_WORK_LIMIT && result.attempts <= Physics4.STEP_ATTEMPT_LIMIT,
          'bounded complete step including retries');
        if (!result.advanced) {
          stats.skipped++;
          if (!result.cached) {
            if (result.reason === 'time') stats.timeouts++;
            else if (result.reason === 'budget') stats.workExhaustions++;
            else stats.convergenceFailures++;
          }
          stats.maxSkippedStepMs = Math.max(stats.maxSkippedStepMs, elapsed);
          assert.equal(result.advancedTime, 0);
          assert.equal(JSON.stringify(world.bodies), before, 'exact rollback, including forces/torques');
          assert.equal(world._collisionContacts, contacts, 'rollback contact cache');
          assert.equal(world._solverResult, solver, 'rollback accepted residual');
          assert.equal(mechanical(world), energy, 'skipping cannot manufacture mechanical energy');
          assert(view.solverWarning.length > 0, 'every skipped frame has a visible explanation');
        } else {
          stats.advancedSeconds += result.advancedTime;
          assert(!world._solverResult || world._solverResult.change <= 1e-12, 'unchanged acceptance residual');
        }
        if (g === 0) assert(mechanical(world) <= energy + 1e-8, 'no unforced energy gain');
        world.bodies.forEach((body, j) => {
          assert(body.position.concat(body.velocity, body.orientation, body.angularVelocity, body.force, body.torque)
            .every(Number.isFinite), 'no NaN/Infinity');
          const floorDepth = Physics4.floorContacts(body, world.floorY).depth;
          stats.maxDepth = Math.max(stats.maxDepth, floorDepth);
          assert(floorDepth < 1e-8, 'floor penetration remains bounded');
          for (const other of world.bodies.slice(j + 1)) {
            if (!Collide4.broadPhase(body, other)) continue;
            const hit = body.shape === 'box4' && other.shape === 'box4'
              ? Collide4.sat(body, other) : Collide4.collide(body, other);
            if (hit) {
              stats.maxDepth = Math.max(stats.maxDepth, hit.depth);
              assert(hit.depth < 1e-8, 'pair penetration remains bounded');
            }
          }
        });
      }
      assert.equal(view.skippedFrames, stats.skipped);
      assert.equal(world.skippedSteps, stats.skipped);
      assert(Math.abs(stats.advancedSeconds + stats.skipped * view.timeStep - 10) < 1e-10,
        'all ten seconds accounted for, skipped time is not fake progress');
      view.resetScene();
      assert.equal(world.skippedSteps, 0);
      assert.equal(view.solverWarning, '');
      assert.equal(world._failedStep, null);
      assert.equal(world.stepResult, null);
      passed++;
      console.log('PASS ' + name);
    } catch (error) {
      failed++;
      console.error('FAIL ' + name + '\n' + error.stack);
    }
    console.log('GRID ' + JSON.stringify(stats));
  }
}
assert(passed + failed > 0, 'no grid cases selected');
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

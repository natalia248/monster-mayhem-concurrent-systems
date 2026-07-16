'use strict';

/**
 * A minimal promise-chain mutex.
 *
 * Monster Mayhem runs many games concurrently, and within a single game
 * several players can send actions (place / move / end-turn) at effectively
 * the same instant because turns are simultaneous, not sequential. Node's
 * event loop interleaves the async work for those socket events (JSON
 * parsing, the eventual stats file write, etc.), so two actions for the
 * SAME game could otherwise read-modify-write the shared board state out of
 * order and corrupt it (a classic race condition).
 *
 * Each Game instance owns one Mutex. Every action handler wraps its logic in
 * mutex.runExclusive(...), which chains work onto a single promise queue so
 * that, for a given game, only one action is ever "in flight" at a time.
 * Different games use different Mutex instances, so they still run fully in
 * parallel - only actions competing for the SAME shared state are serialized.
 */
class Mutex {
  constructor() {
    this._queue = Promise.resolve();
  }

  runExclusive(fn) {
    const result = this._queue.then(() => fn());
    // Swallow rejections so one failed action doesn't wedge the queue for
    // everyone else - the caller still sees the original rejection.
    this._queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

module.exports = Mutex;

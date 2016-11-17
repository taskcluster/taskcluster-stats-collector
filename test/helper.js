import load from '../lib/main';
import collectorManager from '../lib/collectormanager';
import EventEmitter from 'events';
import debugModule from 'debug';
import assume from 'assume';

class FakeQueue {
  constructor () {
    this.statuses = {};
  }

  setStatus (taskId, runStates) {
    if (typeof runStates === 'string') {
      runStates = [runStates];
    }

    this.statuses[taskId] = {
      status: {
        runs: runStates.map(state => { return {state}; }),
      },
    };
  }

  async status (taskId) {
    assume(this.statuses).to.include(taskId);
    return this.statuses[taskId];
  }
};

class FakeClock {
  constructor () {
    this._msec = 1000000000;
    this._timers = [];
    this._debug = debugModule('FakeClock');
  }

  // advance the fake clock..
  async tick (msec) {
    const until = this._msec + msec;

    while (this._msec < until) {
      this._msec = this._timers.reduce((next, timer) => timer.next < next ? timer.next : next, until);
      this._debug(`${this._msec}: tick`);

      const timers = this._timers;
      this._timers = [];
      await Promise.all(timers.map(async timer => {
        if (timer.next <= this._msec) {
          this._debug(`${this._msec}: calling periodic function ${timer.name}`);
          await timer.run();
        } else {
          this._timers.push(timer);
        }
      }));
    }
  }

  msec () {
    return this._msec;
  }

  setTimeout (name, fn, delay) {
    if (delay < 0) {
      throw new Error('setTimeout called with a negative delay');
    }
    this._timers.push({name, fn, next: this._msec + when});
  }

  periodically (interval, name, fn) {
    // note that, in testing, errors are fatal
    const run = async () => {
      await fn();
      this._timers.push({name, run, next: this._msec + interval});
    };
    this._timers.push({name, run, next: this._msec + interval});
  }

  throttle (fn) {
    // for testing, do not apply throttling
    return fn;
  }
};

export const makeCollector = async name => {
  const fakes = {};

  fakes.monitor = await load('monitor', {profile: 'test'}); // mocked in the test profile
  fakes.listener = new EventEmitter();
  fakes.queue = new FakeQueue();
  fakes.clock = new FakeClock();

  fakes.profile = 'test';

  await load(`collector.${name}`, fakes);

  return fakes;
};

const load = require('../src/main');
const collectorManager = require('../src/collectormanager');
const EventEmitter = require('events');
const debugModule = require('debug');
const assume = require('assume');
const {Writable, Readable} = require('stream');
const {fakeauth, stickyLoader, Secrets} = require('taskcluster-lib-testing');

exports.load = stickyLoader(load);

suiteSetup(async function() {
  exports.load.inject('profile', 'test');
  exports.load.inject('process', 'test');
});

// set up the testing secrets
exports.secrets = new Secrets({
  secretName: 'project/taskcluster/testing/taskcluster-stats-collector',
  secrets: {
    pulse: [
      {env: 'PULSE_USERNAME', cfg: 'pulse.username'},
      {env: 'PULSE_PASSWORD', cfg: 'pulse.password'},
      {env: 'PULSE_HOSTNAME', cfg: 'pulse.hostname'},
      {env: 'PULSE_VHOST', cfg: 'pulse.vhost'},
    ],
    taskcluster: [
      {env: 'TASKCLUSTER_ROOT_URL', cfg: 'taskcluster.rootUrl', name: 'rootUrl'},
      {env: 'TASKCLUSTER_CLIENT_ID', cfg: 'taskcluster.credentials.clientId', name: 'clientId'},
      {env: 'TASKCLUSTER_ACCESS_TOKEN', cfg: 'taskcluster.credentials.accessToken', name: 'accessToken'},
    ],
  },
  load: exports.load,
});

class FakeQueue {
  constructor() {
    this.statuses = {};
    this.pendingCounts = {};
  }

  setStatus(taskId, runStates) {
    if (typeof runStates === 'string') {
      runStates = [runStates];
    }

    this.statuses[taskId] = {
      status: {
        runs: runStates.map(state => { return {state}; }),
      },
    };
  }

  async pendingTasks(provisionerId, workerType) {
    return this.pendingCounts[`${provisionerId}.${workerType}`] || 0;
  }

  async status(taskId) {
    assume(this.statuses).to.include(taskId);
    return this.statuses[taskId];
  }
};

class FakeClock {
  constructor() {
    this._msec = 1000000000;
    this._timers = [];
    this._debug = debugModule('FakeClock');
  }

  // advance the fake clock, with some node ticks included
  async tick(msec) {
    await new Promise(process.nextTick);
    const until = this._msec + msec;

    while (this._msec < until) {
      await new Promise(process.nextTick);

      this._msec = this._timers.reduce((next, timer) => timer.next < next ? timer.next : next, until);
      this._debug(`${this._msec}: tick`);

      const timers = this._timers;
      this._timers = [];
      await Promise.all(timers.map(async timer => {
        if (timer.next <= this._msec) {
          this._debug(`${this._msec}: calling function ${timer.name}`);
          await timer.run();
        } else {
          this._timers.push(timer);
        }
      }));
    }
  }

  msec() {
    return this._msec;
  }

  setTimeout(name, fn, delay) {
    if (delay < 0) {
      throw new Error('setTimeout called with a negative delay');
    }
    this._timers.push({name, run: fn, next: this._msec + delay});
  }

  periodically(interval, name, fn) {
    // note that, in testing, errors are fatal
    const run = async () => {
      await fn();
      this._timers.push({name, run, next: this._msec + interval});
    };
    this._timers.push({name, run, next: this._msec + interval});
  }

  throttle(fn) {
    // for testing, do not apply throttling
    return fn;
  }
};

class FakeSignalFxRest {
  constructor() {
    this.datapoints = [];
  }

  fakeDatapoint(query, timestamp, value) {
    if (!(query in this.datapoints)) {
      this.datapoints[query] = [];
    }
    this.datapoints[query].push([timestamp, value]);
  }

  async timeserieswindow({query, startMs, endMs, resolution}) {
    if (!(query in this.datapoints)) {
      throw new Error(`no fake datapoints for ${query}`);
    }
    return this.datapoints[query].filter(dp => dp[0] >= startMs && dp[0] <= endMs);
  }
};

class FakeIngest {
  constructor() {
    this.ingested = [];
  }

  send(req) {
    this.ingested.push(req);
  }
};

class MetricStreamSource extends Readable {
  constructor(clock) {
    super({objectMode: true});
    this.clock = clock;
    this.on('error', console.error);
    this.live = false;
  }

  sendAt(when, dp) {
    const push = () => {
      if (dp.live && !this.live) {
        this.live = true;
        this.emit('live');
      }
      this.emit('data', dp);
    };

    this.clock.setTimeout(`send datapoint ${JSON.stringify(dp)}`, push, when - this.clock.msec());
  } 

  _read() {
    // prevent repeatedly calling this method
    this.pause();
  }
};

class MetricStreamSink extends Writable {
  constructor(clock) {
    super({objectMode: true});
    this.clock = clock;
    this.received = [];
    this.on('error', console.error);
  }

  _write(chunk, enc, next) {
    this.received.push({received: this.clock.msec(), chunk});
    next();
  }
};

module.exports.makeCollector = async name => {
  const fakes = {};

  fakes.monitor = await load('monitor', {profile: 'test'}); // mocked in the test profile
  fakes.listener = new EventEmitter();
  fakes.queue = new FakeQueue();
  fakes.clock = new FakeClock();
  fakes.signalFxRest = new FakeSignalFxRest();
  fakes.ingest = new FakeIngest();

  fakes.profile = 'test';

  // capture the context (`this`) for the collector
  fakes.collector = await load(`collector.${name}`, fakes);

  return fakes;
};

exports.FakeQueue = FakeQueue;
exports.FakeClock = FakeClock;
exports.FakeSignalFxRest = FakeSignalFxRest;
exports.FakeIngest = FakeIngest;
exports.MetricStreamSource = MetricStreamSource;
exports.MetricStreamSink = MetricStreamSink;

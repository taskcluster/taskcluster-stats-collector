var debug = require('debug')('stats-collector:collector');
var _ = require('lodash');
var assert = require('assert');
var taskcluster = require('taskcluster-client');

class Collector {
  /**
   * Creates an instace of a stats collector which automatically decodes pulse
   * messages and writes them to the statsum
   *
   * The options argument requires the following options:
   *
   * credentials: Pulse username and password
   * monitor: A monitor client from taskcluster-lib-monitor
   * routingKey: Optional, arguments to QueueEvents in taskcluster-client used
   * to listen to specific routing keys
   *
   */
  constructor (options) {
    this._options = _.defaults({}, options, {
      routingKey: {}, // default option
    });
    assert(this._options.credentials.username, 'Need Pulse credentials!');
    assert(this._options.credentials.password, 'Need Pulse credentials!');

    assert(this._options.monitor, 'Need a monitor from taskcluster-lib-monitor!');
    this.monitor = this._options.monitor;

    // tasks that are currently pending, shaped as
    // {
    //   dims: {
    //     workerType: ..,
    //   },
    //   pendingStarted: ..,
    //   pendingEnded: ..,
    // }
    this.waitingTasks = {};

    // all known workerTypes
    this.seenWorkerTypes = new Set();

    this.connection = new taskcluster.PulseConnection(this._options.credentials);
    this.listener = new taskcluster.PulseListener({
      connection: this.connection,
      queueName: this.queueName,
    });
    this._flushTimer = null;
  }

  static async createCollector (options) {
    var collector = new Collector(options);
    var queueEvents = new taskcluster.QueueEvents();
    collector.listener.bind(queueEvents.taskPending(collector._options.routingKey));
    collector.listener.bind(queueEvents.taskRunning(collector._options.routingKey));
    collector.listener.bind(queueEvents.taskCompleted(collector._options.routingKey));
    collector.listener.bind(queueEvents.taskFailed(collector._options.routingKey));
    collector.listener.bind(queueEvents.taskException(collector._options.routingKey));
    collector.listener.on('message', message => collector.onMessage(message));
    await collector.listener.resume();
    debug('Listening begins');
    await collector.flush();
    return collector;
  }

  taskPending (payload) {
    let taskId = payload.status.taskId;
    let runId = payload.runId;
    let key = `${taskId}/${runId}`;
    let workerType = payload.status.workerType;

    debug('task pending: %s', key);

    if (_.includes(Object.keys(this.waitingTasks).includes, key)) {
      return;
    }

    this.waitingTasks[key] = {
      dims: {workerType},
      pendingStarted: new Date(payload.status.runs[runId].scheduled),
    };
    this.seenWorkerTypes.add(workerType);
  }

  taskNotPending (payload) {
    let taskId = payload.status.taskId;
    let runId = payload.runId;
    let key = `${taskId}/${runId}`;
    let workerType = payload.status.workerType;

    debug('task no longer pending: %s', key);

    if (!_.includes(Object.keys(this.waitingTasks).includes, key)) {
      this.waitingTasks[key] = {
        dims: {workerType},
        pendingStarted: new Date(payload.status.runs[runId].scheduled),
      };
      this.seenWorkerTypes.add(workerType);
    }

    let run = payload.status.runs[runId];
    this.waitingTasks[key].pendingEnded = new Date(run.started || run.resolved);
  }

  async flush () {
    debug('Flushing pending wait times. %d tasks pending', Object.keys(this.waitingTasks).length);
    clearTimeout(this._flushTimer);
    this._flushTimer = null;
    if (Object.keys(this.waitingTasks).length === 0) {
      this._flushTimer = setTimeout(() => this.flush(), 30 * 1000);
      return;
    }

    let seenThisFlush = new Set();

    for (let id in this.waitingTasks) {
      let task = this.waitingTasks[id];
      debug(task);
      let waitTime = Date.now() - task.pendingStarted;

      if (task.pendingEnded) {
        waitTime = task.pendingEnded - task.pendingStarted;
        // no need to measure this task again
        delete this.waitingTasks[id];
      }

      seenThisFlush.add(task.dims.workerType);
      this.monitor.measure(`tasks.${task.dims.workerType}.pending`, waitTime);
    }

    // measure zero pending for any workerType that has not been measured this
    // iteration; this provides a data point for every workerType during every
    // aggregation interval in statsum.
    this.seenWorkerTypes.forEach(workerType => {
      if (!seenThisFlush.has(workerType)) {
        this.monitor.measure(`tasks.${workerType}.pending`, 0);
      }
    });

    this._flushTimer = setTimeout(() => this.flush(), 30 * 1000);
  }

  onMessage (message) {
    let that = this;
    let {payload, exchange} = message;
    //debug('received message on exchange: %s, message %j', exchange, payload);
    if (exchange === 'exchange/taskcluster-queue/v1/task-pending') {
      return this.taskPending(payload);
    } else {
      this.taskNotPending(payload);
      if (exchange === 'exchange/taskcluster-queue/v1/task-running') {
        return;
      }
    }

    try {
      var runs = message.payload.status.runs;
      var lastNonRetry = _.findLastIndex(runs, run => {
        return run.reasonCreated !== 'retry';
      });
      if (lastNonRetry === -1) {
        lastNonRetry = 0;
      }
      let workerType = payload.status.workerType;
      runs.slice(lastNonRetry).forEach(run => {
        if (run.reasonResolved !== 'deadline-exceeded') {
          var started = new Date(run.started);
          var resolved = new Date(run.resolved);
          that.monitor.measure(`tasks.${workerType}.running`, resolved - started);
        }
        that.monitor.count(`tasks.${workerType}.resolved.${run.reasonResolved}`);
      });
    } catch (err) {
      console.log(err.stack);
    }
  }

  async close () {
    debug('collector shutting down...');
    await this.connection.close();
    await this.monitor.flush();
  }
}

module.exports = Collector.createCollector;

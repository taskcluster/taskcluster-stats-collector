var debug = require('debug')('stats-collector:collector');
var _ = require('lodash');
var assert = require('assert');
var taskcluster = require('taskcluster-client');
var Statsum = require('./statsum');

class Collector {
  /**
   * Creates an instace of a stats collector which automatically decodes pulse
   * messages and writes them to the DB
   *
   * The options argument requires the following options:
   *
   * credentials: Pulse username and password
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

    this.stats = new Statsum(this._options.statsum);
    this.waitingTasks = {};

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

  handleTaskPending(payload) {
    let taskId = payload.status.taskId;
    let runId = payload.runId;
    let key = `${taskId}/${runId}`;
    debug('handle pending task %s', key);

    if (Object.keys(this.waitingTasks).includes(key)) {
      return;
    }

    this.waitingTasks[key] = {
      dims: {
        workerType: payload.status.workerType,
      },
      pending: new Date(payload.status.runs[runId].scheduled),
    };
  }

  handleTaskRunning(payload) {
    let taskId = payload.status.taskId;
    let runId = payload.runId;
    let key = `${taskId}/${runId}`;
    debug('handle running task %s', key);

    if (!Object.keys(this.waitingTasks).includes(key)) {
      this.waitingTasks[key] = {
        dims: {
          workerType: payload.status.workerType,
        },
        pending: new Date(payload.status.runs[runId].scheduled),
      };
    }

    this.waitingTasks[key].started = new Date(payload.status.runs[runId].started);
  }

  async flush() {
    debug('Flushing pending wait times. %d tasks pending', Object.keys(this.waitingTasks).length);
    clearTimeout(this._flushTimer);
    this._flushTimer = null;
    if (Object.keys(this.waitingTasks).length === 0) {
      this._flushTimer = setTimeout(() => this.flush(), 30 * 1000);
      return;
    }

    for (let id in this.waitingTasks) {
      let task = this.waitingTasks[id];
      debug(task);
      let waitTime = Date.now() - task.pending;

      if (task.started) {
        waitTime = task.started - task.pending;
        delete this.waitingTasks[id];
      }

      this.stats.value(`tasks.${task.dims.workerType}.pending`, waitTime);
    }

    this._flushTimer = setTimeout(() => this.flush(), 30 * 1000);
  }

  onMessage (message) {
    let { payload, exchange } = message;
    //debug('received message on exchange: %s, message %j', exchange, payload);
    if (exchange === 'exchange/taskcluster-queue/v1/task-pending') {
      return this.handleTaskPending(payload);
    }

    if (exchange === 'exchange/taskcluster-queue/v1/task-running') {
      return this.handleTaskRunning(payload);
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
          this.stats.value(`tasks.${workerType}.running`, resolved - started);
        }
        this.stats.count(`tasks.${workerType}.resolved.${run.reasonResolved}`);
      });
    } catch (err) {
      console.log(err.stack);
    }
  }

  async close () {
    debug('collector shutting down...');
    await this.connection.close();
    await this.stats.flush();
  }
}

module.exports = Collector.createCollector;

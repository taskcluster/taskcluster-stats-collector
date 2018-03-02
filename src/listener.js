var debug = require('debug')('TaskListener');
var _ = require('lodash');
var assert = require('assert');
var taskcluster = require('taskcluster-client');
var EventEmitter = require('events');
let collectorManager = require('./collectormanager');

class TaskListener extends EventEmitter {
  /**
   * Creates an instace of a listener which automatically decodes pulse
   * messages regarding task status changes and emits events.  The events
   * are named 'task-message' and have body {action, taskId, payload}, where
   * "action" is the last bit of the exchange name, e.g., "task-running".
   *
   * The options argument requires the following options:
   *
   * credentials: Pulse username and password
   *
   */
  constructor(options) {
    assert(options.credentials.username, 'Need Pulse credentials!');
    assert(options.credentials.password, 'Need Pulse credentials!');

    super();

    let routingKey = options.routingKey || {};

    this.connection = new taskcluster.PulseConnection(options.credentials);
    this.listener = new taskcluster.PulseListener({
      connection: this.connection,
    });
    var queueEvents = new taskcluster.QueueEvents();
    this.listener.bind(queueEvents.taskPending(routingKey));
    this.listener.bind(queueEvents.taskRunning(routingKey));
    this.listener.bind(queueEvents.taskCompleted(routingKey));
    this.listener.bind(queueEvents.taskFailed(routingKey));
    this.listener.bind(queueEvents.taskException(routingKey));
    this.listener.on('message', message => this.onMessage(message));

    collectorManager.on('started', () => {
      return this.start().catch((err) => {
        console.error(err);
        console.log('crashing');
        process.exit(1);
      });
    });
  }

  async start() {
    debug('starting');
    await this.listener.resume();
  }

  async close() {
    debug('hutting down');
    await this.listener.close();
    await this.connection.close();
  }

  onMessage(message) {
    let that = this;
    let {payload, exchange} = message;
    let action = exchange.split('/').pop();
    let taskId = payload.status.taskId;

    this.emit('task-message', {action, payload, taskId});
  }
}

module.exports = TaskListener;

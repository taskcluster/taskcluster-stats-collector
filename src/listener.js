const debug = require('debug')('TaskListener');
const _ = require('lodash');
const assert = require('assert');
const taskcluster = require('taskcluster-client');
const {consume} = require('taskcluster-lib-pulse');
const EventEmitter = require('events');
const collectorManager = require('./collectormanager');

class TaskListener extends EventEmitter {
  /**
   * Creates an instace of a listener which automatically decodes pulse
   * messages regarding task status changes and emits events.  The events
   * are named 'task-message' and have body {action, taskId, payload}, where
   * "action" is the last bit of the exchange name, e.g., "task-running".
   *
   * The options argument requires the following options:
   *
   * rootUrl: deployment rootUrl
   * client: a tc-lib-pulse Client
   *
   */
  constructor(options) {
    assert(options.rootUrl, 'Need rootUrl');
    assert(options.client, 'Need client');
    super();

    this.rootUrl = options.rootUrl;
    this.client = options.client;

    // (tests set these)
    this.routingKey = {};
    this.queueName = 'tasks';
    this.queueOptions = {};

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
    const queueEvents = new taskcluster.QueueEvents({rootUrl: this.rootUrl});
    this.consumer = await consume({
      client: this.client,
      bindings: [
        queueEvents.taskPending(this.routingKey),
        queueEvents.taskRunning(this.routingKey),
        queueEvents.taskCompleted(this.routingKey),
        queueEvents.taskFailed(this.routingKey),
        queueEvents.taskException(this.routingKey),
      ],
      queueName: this.queueName,
      prefetch: 5,
      ...this.queueOptions,
    }, message => {
      const {payload, exchange} = message;
      const action = exchange.split('/').pop();
      const taskId = payload.status.taskId;

      this.emit('task-message', {action, payload, taskId});
    });
  }

  async close() {
    debug('shutting down');
    if (this.consumer) {
      await this.consumer.stop();
      delete this.consumer;
    }
  }
}

module.exports = TaskListener;

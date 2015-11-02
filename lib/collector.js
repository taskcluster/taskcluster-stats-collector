var debug = require('debug')('stats-collector:collector');
var _ = require('lodash');
var assert = require('assert');
var taskcluster = require('taskcluster-client');
var StatHat = require('./stathat');

class Collector {
  /**
   * Creates an instace of a stats collector which automatically decodes pulse
   * messages and writes them to the DB
   *
   * The options argument requires the following options:
   *
   * connectionString: The influxDB connection string
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

    this.stats = new StatHat({
      ezKey: this._options.statehatEZKey,
      prefix: 'stats-collector.',
    });

    this.connection = new taskcluster.PulseConnection(this._options.credentials);
    this.listener = new taskcluster.PulseListener({
      connection: this.connection,
      queueName: this.queueName,
    });
  }

  static async createCollector (options) {
    var collector = new Collector(options);
    var queueEvents = new taskcluster.QueueEvents();
    collector.listener.bind(queueEvents.taskCompleted(collector._options.routingKey));
    collector.listener.bind(queueEvents.taskFailed(collector._options.routingKey));
    collector.listener.bind(queueEvents.taskException(collector._options.routingKey));
    collector.listener.on('message', message => collector.onMessage(message));
    await collector.listener.resume();

    debug('Listening begins');
    return collector;
  }

  onMessage (message) {
    debug('received message: %j', message);
    try {
      var runs = message.payload.status.runs;
      var lastNonRetry = _.findLastIndex(runs, run => {
        return run.reasonCreated !== 'retry';
      });
      if (lastNonRetry === -1) {
        lastNonRetry = 0;
      }
      let provisionerId = message.payload.status.provisionerId;
      let workerType    = message.payload.status.workerType;
      let pfx = provisionerId + '/' + workerType;
      runs.slice(lastNonRetry).forEach(run => {
        var scheduled = new Date(run.scheduled);
        var started = new Date(run.started);
        var resolved = new Date(run.resolved);
        this.stats.value(pfx + '.pending', started - scheduled, scheduled);
        this.stats.value(pfx + '.running', resolved - started, started);
        this.stats.count(pfx + '.resolved.' + run.reasonResolved, 1, resolved);
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

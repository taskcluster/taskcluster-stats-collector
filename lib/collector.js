var debug = require('debug')('stats-collector:collector');
var _ = require('lodash');
var assert = require('assert');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
var series = require('./series.js');

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
    assert(this._options.connectionString, 'Need connection string!');
    assert(this._options.credentials.username, 'Need Pulse credentials!');
    assert(this._options.credentials.password, 'Need Pulse credentials!');

    this.influx = new base.stats.Influx({
      connectionString: this._options.connectionString,
      maxDelay: 100,
      maxPendingPoints: 210,
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

    collector.pendingReporter = series.pendingDuration.reporter(collector.influx);
    collector.runningReporter = series.runningDuration.reporter(collector.influx);
    collector.reasonReporter = series.reasonResolved.reporter(collector.influx);

    debug('Listening begins');
    return collector;
  }

  onMessage (message) {
    var runs = message.payload.status.runs;
    var lastNonRetry = _.findLastIndex(runs, run => {
      return run.reasonCreated !== 'retry';
    });
    if (lastNonRetry === -1) {
      lastNonRetry = 0;
    }

    runs.slice(lastNonRetry).forEach(run => {
      var scheduled = Date.parse(run.scheduled);
      var started = Date.parse(run.started);
      var resolved = Date.parse(run.resolved);
      this.pendingReporter({
        provisionerId:  message.payload.status.provisionerId,
        workerType:     message.payload.status.workerType,
        time:           scheduled,
        duration:       started - scheduled,
      });
      this.runningReporter({
        provisionerId:  message.payload.status.provisionerId,
        workerType:     message.payload.status.workerType,
        time:           started,
        duration:       resolved - started,
      });
      this.reasonReporter({
        provisionerId:  message.payload.status.provisionerId,
        workerType:     message.payload.status.workerType,
        time:           resolved,
        count:          1,
        reasonResolved: run.reasonResolved,
      });
    });
  }

  async close () {
    debug('collector shutting down...');
    await this.connection.close();
    await this.influx.flush();
    await this.influx.close();
  }
}

module.exports = Collector.createCollector;

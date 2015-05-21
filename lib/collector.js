var debug = require('debug')('stats-collector:collector');
var _ = require('lodash');
var assert = require('assert');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
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
    this.listener = new taskcluster.PulseListener({connection: this.connection});
    this.queueEvents = new taskcluster.QueueEvents();
    this.listener.bind(this.queueEvents.taskCompleted(this._options.routingKey))
      .catch(error => debug('Bind error: %s', error));
    this.listener.bind(this.queueEvents.taskFailed(this._options.routingKey))
      .catch(error => debug('Bind error: %s', error));
    this.listener.bind(this.queueEvents.taskException(this._options.routingKey))
      .catch(error => debug('Bind error: %s', error));
    this.listener.on('message', message => this.onMessage(message));
    this.listener.resume();
    this.pendingDuration = new base.stats.Series({
      name:       'pendingDuration',
      columns: {
        provisionerId:      base.stats.types.String,
        workerType:         base.stats.types.String,
        time:               base.stats.types.Number,
        duration:           base.stats.types.Number,
      },
    });
    this.pendingReporter = this.pendingDuration.reporter(this.influx);

    this.runningDuration = new base.stats.Series({
      name:       'runningDuration',
      columns: {
        provisionerId:      base.stats.types.String,
        workerType:         base.stats.types.String,
        time:               base.stats.types.Number,
        duration:           base.stats.types.Number,
      },
    });
    this.runningReporter = this.runningDuration.reporter(this.influx);

    this.reasonResolved = new base.stats.Series({
      name:       'reasonResolved',
      columns: {
        provisionerId:      base.stats.types.String,
        workerType:         base.stats.types.String,
        time:               base.stats.types.Number,
        count:              base.stats.types.Number,
        reasonResolved:     base.stats.types.String,
      },
    });
    this.reasonReporter = this.reasonResolved.reporter(this.influx);
    debug('Listening begins');
  }

  onMessage (message) {
    var runs = message.payload.status.runs;
    function statRun (run) {
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
    }
    var lastNonRetry = runs.lastIndexOf(run => {
      return run.reasonCreated !== 'retry';
    });
    if (lastNonRetry === -1) {
      runs.map(run => statRun.call(this, run));
    }
    else {
      runs.slice(lastNonRetry).map(run => statRun.call(this, run));
    }
  }

  async close () {
    debug('collector shutting down...');
    await this.connection.close();
    await this.influx.flush();
    await this.influx.close();
  }
}

exports.Collector = Collector;

var debug = require('debug')('stats-collector:collector');
var _ = require('lodash');
var assert = require('assert');
var Promise = require('promise');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
class Collector {
  constructor(options) {
    this._options = _.defaults({}, options, {
        routingKey: {} // default option
    });
    assert(this._options.connectionString,'Need connection string!');
    assert(this._options.credentials.username,'Need Pulse credentials!');
    assert(this._options.credentials.password,'Need Pulse credentials!');
    this.influx = new base.stats.Influx({
      connectionString: this._options.connectionString,
      maxDelay:100,
      maxPendingPoints:90
    });
    this.connection=new taskcluster.PulseConnection(this._options.credentials);
    this.listener = new taskcluster.PulseListener({connection: this.connection});
    this.queueEvents = new taskcluster.QueueEvents();
    //set routingKey
    this.listener.bind(this.queueEvents.taskCompleted(this._options.routingKey))
      .catch(error => debug('Bind error: %s',error));
    this.listener.bind(this.queueEvents.taskFailed(this._options.routingKey))
      .catch(error => debug('Bind error: %s',error));
    this.listener.bind(this.queueEvents.taskException(this._options.routingKey))
      .catch(error => debug('Bind error: %s',error));
    this.listener.on('message',message => this.onMessage(message));
    this.listener.resume();
    debug('Listening begins');
  }

  onMessage (message) {
    var runs=message.payload.status.runs;
    var idx=runs.length-1;
    var run=runs[idx];
    function statRun (run) {
      var scheduled=(Date.parse(run.scheduled));
      var started=(Date.parse(run.started));
      var resolved=(Date.parse(run.resolved));
      this.influx.addPoint('pendingDuration',{
        provisionerId:message.payload.status.provisionerId,
        workerType:message.payload.status.workerType,
        time:scheduled,
        duration:started-scheduled
      });
      this.influx.addPoint('runningDuration',{
        provisionerId:message.payload.status.provisionerId,
        workerType:message.payload.status.workerType,
        time:started,
        duration:resolved-started
      });
      this.influx.addPoint('reasonResolved',{
        provisionerId:message.payload.status.provisionerId,
        workerType:message.payload.status.workerType,
        time:resolved,
        count:1,
        reasonResolved:run.reasonResolved
      });
      if (run.reasonCreated==='retry'&&idx>0) {
        statRun(runs[--idx]);
      }
    }
    statRun.call(this,run);
  }

  async close() {
    debug('collector shutting down...');
    await this.connection.close();
    await this.influx.flush();
    await this.influx.close();
  }
}


exports.Collector=Collector;

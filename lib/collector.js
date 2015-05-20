var debug = require('debug')('stats-collector:collector');
var _ = require('lodash');
var assert = require('assert');
var Promise = require('promise');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
var cfg = require('../bin/config.js')
var Collector=function(routingKey) {
  this.influx = new base.stats.Influx({
    connectionString: cfg.get('influxdb:connectionString'),
    maxDelay:100,
    maxPendingPoints:90
  });
  this.connection=new taskcluster.PulseConnection({
        username: cfg.get('pulse:username'),
        password: cfg.get('pulse:password')
    });
  this.completedListener = new taskcluster.PulseListener({connection:this.connection});
  this.failedListener = new taskcluster.PulseListener({connection:this.connection});
  this.exceptionListener = new taskcluster.PulseListener({connection:this.connection});  
  this.queueEvents = new taskcluster.QueueEvents();
  if(routingKey===undefined)
    this.routingKey={};
  else
    this.routingKey = routingKey;
  this.completedListener.bind(this.queueEvents.taskCompleted(routingKey)).catch(error => debug('Bind error: %s',error));
  this.failedListener.bind(this.queueEvents.taskFailed(routingKey)).catch(error => debug('Bind error: %s',error));
  this.exceptionListener.bind(this.queueEvents.taskException(routingKey)).catch(error => debug('Bind error: %s',error));
  this.completedListener.on('message',message => statMessage(message,this));
  this.failedListener.on('message',message => statMessage(message,this));
  this.exceptionListener.on('message',message => statMessage(message,this));
  this.completedListener.resume();
  this.failedListener.resume();
  this.exceptionListener.resume();
  debug('Listening begins');
}
var statMessage = function (message,collector) {
  var runs=message.payload.status.runs;
  var idx=runs.length-1;
  var run=runs[idx];
  function statRun (run) {
    var scheduled=(Date.parse(run.scheduled));
    var started=(Date.parse(run.started));
    var resolved=(Date.parse(run.resolved));
    collector.influx.addPoint('pendingDuration',{
      provisionerId:message.payload.status.provisionerId,
      workerType:message.payload.status.workerType,
      time:scheduled,
      duration:started-scheduled
    });
    collector.influx.addPoint('runningDuration',{
      provisionerId:message.payload.status.provisionerId,
      workerType:message.payload.status.workerType,
      time:started,
      duration:resolved-started
    });
    collector.influx.addPoint('reasonResolved',{
      provisionerId:message.payload.status.provisionerId,
      workerType:message.payload.status.workerType,
      time:resolved,
      count:1,
      reasonResolved:run.reasonResolved
    });
    if(run.reasonCreated==='retry'&&idx>0)
      statRun(runs[--idx]);
  }
  statRun(run);
}
Collector.prototype.close = function() {
  debug('collector shutting down...');
  this.completedListener.close();
  this.failedListener.close();
  this.exceptionListener.close();
  this.connection.close();
  debug(this.influx.pendingPoints());
  this.influx.flush();
  debug(this.influx.pendingPoints());
  this.influx.close();
};
module.exports.Collector=Collector;

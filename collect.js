var debug = require('debug')('collect');
var _ = require('lodash');
var assert = require('assert');
var Promise = require('promise');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
var main = async function () {
	var cfg = base.config({
	  defaults: {},
	  profile:  {},
	  envs: [
	    'pulse_username',
	    'pulse_password',
	    'influxdb_connectionString'
	  ],
	  filename: 'collect'
	});
	var influx = new base.stats.Influx({
		connectionString: cfg.get('influxdb:connectionString')
	});
	function statMessage (message) {
		var runs=message.payload.status.runs;
		var idx=runs.length-1
		var run=runs[idx]
		function statRun (run) {
			var scheduled=(Date.parse(run.scheduled));
			var started=(Date.parse(run.started));
			var resolved=(Date.parse(run.resolved));
			influx.addPoint('pendingDuration',{
				provisionerId:message.payload.status.provisionerId,
				workerType:message.payload.status.workerType,
				time:scheduled,
				duration:started-scheduled
			});
			influx.addPoint('runningDuration',{
				provisionerId:message.payload.status.provisionerId,
				workerType:message.payload.status.workerType,
				time:started,
				duration:resolved-started
			});
			influx.addPoint('reasonResolved',{
				provisionerId:message.payload.status.provisionerId,
				workerType:message.payload.status.workerType,
				time:resolved,
				count:1,
				reasonResolved:run.reasonResolved
			});
			if(run.reasonCreated==='retry'&&idx>0)
				statRun(runs[--idx]);
		}
		statRun(run)
	}
	var connection=new taskcluster.PulseConnection({
	    	username: cfg.get('pulse:username'),
	    	password: cfg.get('pulse:password')
		});
	var completedListener = new taskcluster.PulseListener({connection:connection});
	var failedListener = new taskcluster.PulseListener({connection:connection});
	var exceptionListener = new taskcluster.PulseListener({connection:connection});	
	var queueEvents = new taskcluster.QueueEvents();
	completedListener.bind(queueEvents.taskCompleted({})).catch(error => debug('Bind error: %s',error));
	failedListener.bind(queueEvents.taskFailed({})).catch(error => debug('Bind error: %s',error));
	exceptionListener.bind(queueEvents.taskException({})).catch(error => debug('Bind error: %s',error));
	completedListener.on('message',statMessage);
	failedListener.on('message',statMessage);
	exceptionListener.on('message',statMessage);
	await completedListener.resume();
	await failedListener.resume();
	await exceptionListener.resume();
	debug('Listening begins');
	setInterval(function () {
		 influx.flush();
		 debug('data flushed to DB');
	},60*1000);
	// completedListener.close(); how to close everything
	// failedListener.close();
	// exceptionListener.close();
	// connection.close();
	// influx.close()
}
main()
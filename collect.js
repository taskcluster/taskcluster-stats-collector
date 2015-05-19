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
		debug(message.payload.status.taskId);
		influx.addPoint('taskId',{
			taskId:message.payload.status.taskId,
			time:3
		});
	}
	var creds={credentials : {
	    	username: cfg.get('pulse:username'),      // Pulse username from pulse guardian
	    	password: cfg.get('pulse:password')       // Pulse password from pulse guardian
		}
	}
	var completedListener = new taskcluster.PulseListener(creds);
	var failedListener = new taskcluster.PulseListener(creds);
	var exceptionListener = new taskcluster.PulseListener(creds);	
	var queueEvents = new taskcluster.QueueEvents();
	completedListener.bind(queueEvents.taskCompleted({})).catch(error => debug('Bind error: %s',error));
	failedListener.bind(queueEvents.taskFailed({})).catch(error => debug('Bind error: %s',error));
	exceptionListener.bind(queueEvents.taskException({})).catch(error => debug('Bind error: %s',error));
	debug('i tried');
	// completedListener.on('message',message => debug('completed'+JSON.stringify(message,null,2)));
	// failedListener.on('message',message => debug('failed'+JSON.stringify(message,null,2)));
	// exceptionListener.on('message',message => debug('exception'+JSON.stringify(message,null,2)));
	completedListener.on('message',statMessage);
	failedListener.on('message',statMessage);
	exceptionListener.on('message',statMessage);
	await completedListener.resume();
	await failedListener.resume();
	await exceptionListener.resume();
	debug('Listening begins');
	setTimeout(function () {
		 influx.flush();
		 completedListener.close();
		 failedListener.close();
		 exceptionListener.close();
		 influx.close()
	},10000);
}
main()
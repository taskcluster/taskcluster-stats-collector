var debug = require('debug')('create');
var _ = require('lodash');
var assert = require('assert');
var slugid = require('slugid');
var Promise = require('promise');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
var taskdefn = {
	"provisionerId":'aws-provisioner-v1',
	"workerType":'b2gtest',
	"payload":{"image":'ubuntu:13.10',
			"command": [
				"/bin/bash",
				"-c",
				"sleep 200"
				],
			"maxRunTime": 600},
	"created":taskcluster.fromNowJSON(),
	"deadline":taskcluster.fromNowJSON('2 hours'),
	"metadata":{
		"name":'Testing!',
		"description":'testing?',
		"owner":'eggylv999@gmail.com',
		"source":'https://www.mozilla.org/'
	}
};
var id = slugid.v4();
console.log(id);
var queue = new taskcluster.Queue({
	credentials:{
		//should probably fix this before publishing anywhere...
		clientId: 'OXSb5WUVQk6STvKkCPitgw', 
		accessToken: 'iJuPUQz6QZaj40rOeH-JFAXWQkaJ5xQ6Kk8P6KG3D2PQ'
	}
});
var main = async function () {
	var cfg = base.config({
	  defaults: {},
	  profile:  {},
	  envs: [
	    'pulse_username',
	    'pulse_password'
	  ],
	  filename: 'collect'
	});
	var listener = new taskcluster.PulseListener({
	  credentials: {
	    username:           cfg.get('pulse:username'),      // Pulse username from pulse guardian
	    password:           cfg.get('pulse:password')       // Pulse password from pulse guardian
	  }
	});
	var queueEvents = new taskcluster.QueueEvents();
	listener.bind(queueEvents.taskPending({taskId:id}));
	listener.on('message',message => console.log(JSON.stringify(message,null,2)));
	await listener.resume();
	try{
		var result = await queue.createTask(id,taskdefn);
		// console.log(JSON.stringify(result.status,null,2));
	}
	catch(error){
		debug('Got error: %s as json %j',error,error);
	}
	listener.close();
}
main()
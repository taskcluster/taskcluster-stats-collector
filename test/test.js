var debug = require('debug')('test:test')
var assume = require('assume')
var collector = require('../lib/collector.js');
var slugid = require('slugid');
var Promise = require('promise');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
var cfg = require('../bin/config.js')
var taskdefn = {
  "provisionerId":'no-provisioner',
  "workerType":'stats-dummy',
  "payload":{"image":'ubuntu:13.10',
      "command": [
        "/bin/bash",
        "-c",
        "sleep 2"
        ],
      "maxRunTime": 600},
  "created":taskcluster.fromNowJSON(),
  "deadline":taskcluster.fromNowJSON('2 hours'),
  "metadata":{
    "name":'Testing!',
    "description":'testing?',
    "owner":'eggylv999@gmail.com',
    "source":'https://github.com/taskcluster/taskcluster-stats-collector'
  }
};
async function test () {
  var col = new collector.Collector();
  var id = slugid.v4();
  var queue = new taskcluster.Queue({
    credentials:{
      clientId: cfg.get('taskcluster:clientId'), 
      accessToken: cfg.get('taskcluster:accessToken')
    }
  });
  var result = await queue.createTask(id,taskdefn);
  assume(result).ok;
}
test();

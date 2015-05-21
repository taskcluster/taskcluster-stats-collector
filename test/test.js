var debug = require('debug')('test:test');
var assume = require('assume');
var collector = require('../lib/collector.js');
var slugid = require('slugid');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
var cfg = base.config({
  defaults: {},
  profile: {},
  envs: [
    'pulse_username',
    'pulse_password',
    'influxdb_connectionString',
    'taskcluster_clientId',
    'taskcluster_accessToken',
  ],
  filename: 'collect',
});
var taskdefn = {
  provisionerId: 'stats-provisioner',
  workerType: 'stats-dummy',
  payload: { image: 'ubuntu:13.10',
      command: [
        '/bin/bash',
        '-c',
        'sleep 2',
        ],
      maxRunTime: 600,
    },
  created: taskcluster.fromNowJSON(),
  deadline: taskcluster.fromNowJSON('2 hours'),
  metadata: {
    name: 'Testing!',
    description: 'testing?',
    owner: 'eggylv999@gmail.com',
    source: 'https://github.com/taskcluster/taskcluster-stats-collector',
  },
};

async function test () {
  var col = new collector.Collector({
    credentials: cfg.get('pulse'),
    connectionString: cfg.get('influxdb:connectionString'),
    routingKey: {
      provisionerId: 'stats-provisioner',
    },
  }
  );
  var id = slugid.v4();
  var queue = new taskcluster.Queue({
    credentials: cfg.get('taskcluster'),
  });
  var result = await queue.createTask(id, taskdefn);
  assume(result).ok;
  debug('task created');
  await queue.claimTask(id, 0, {
      workerGroup:    'my-worker-group',
      workerId:       'my-worker',
    });
  debug('task claimed');
  await queue.reportException(id, 0, {reason: 'worker-shutdown'});
  debug('task exception');
  await queue.claimTask(id, 1, {
      workerGroup:    'my-worker-group',
      workerId:       'my-worker',
    });
  debug('task claimed again');
  await queue.reportCompleted(id, 1);
  debug('task completed');
  setTimeout(() => {
    assume(col.influx.pendingPoints()).equal(6); //this test will break if more points are added
    col.close();
  }, 5000);
}

test();

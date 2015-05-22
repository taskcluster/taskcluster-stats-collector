var base = require('taskcluster-base');
var collector = require('../lib/collector.js');

var cfg = base.config({
  defaults: {},
  profile: {},
  envs: [
    'pulse_username',
    'pulse_password',
    'listener_queueName',
    'influxdb_connectionString',
    'taskcluster_clientId',
    'taskcluster_accessToken',
  ],
  filename: '../collect',
});

collector({ //class from lib/collector.js
    // String with required information to connect to influxDB
    connectionString: cfg.get('influxdb:connectionString'),
    // Name of durable queue on pulse, so we can have
    // multiple instances of the collector
    queueName: cfg.get('listener:queueName'),
    credentials: cfg.get('pulse'),
    routingKey: {}, // different in tests
});

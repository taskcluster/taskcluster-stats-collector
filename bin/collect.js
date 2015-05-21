var base = require('taskcluster-base');
var collector = require('../lib/collector.js');
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
  filename: '../collect',
});

var collector = new collector.Collector({ //class from lib/collector.js
    // String with required information to connect to influxDB
    connectionString: cfg.get('influxdb:connectionString'),
    // Name of durable queue on pulse, so we can have
    // multiple instances of the collector
    credentials: cfg.get('pulse'),
    routingKey: {}, // different in tests
});

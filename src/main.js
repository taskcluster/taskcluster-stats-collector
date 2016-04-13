var collector  = require('./collector.js');
var monitoring = require('taskcluster-lib-monitor');
let base = require('taskcluster-base');

let load = base.loader({
  cfg: {
    requires: ['profile'],
    setup: ({profile}) => base.config({profile}),
  },

  monitor: {
    requires: ['cfg'],
    setup: ({cfg}) => monitoring({
      project: 'tc-stats-collector',
      credentials: cfg.taskcluster.credentials,
    }),
  },

  server: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => collector({
      // Name of durable queue on pulse, so we can have
      // multiple instances of the collector
      queueName: cfg.app.queueName,
      monitor,
      credentials: cfg.pulse,
      routingKey: {}, // different in tests
    }),
  },
}, ['profile', 'process']);

// If this file is executed launch component from first argument
if (!module.parent) {
  load(process.argv[2], {
    process: process.argv[2],
    profile: process.env.NODE_ENV,
  }).catch(err => {
    console.log(err.stack);
    process.exit(1);
  });
}

// Export load for tests
module.exports = load;

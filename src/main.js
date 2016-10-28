var TaskListener  = require('./listener.js');
var monitoring = require('taskcluster-lib-monitor');
let loader = require('taskcluster-lib-loader');
let docs = require('taskcluster-lib-docs');

let load = loader({
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

  listener: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => new TaskListener({
      credentials: cfg.pulse,
      routingKey: {}, // different in tests
    }),
  },

  docs: {
    requires: ['cfg'],
    setup: ({cfg}) => docs.documenter({
      credentials: cfg.taskcluster.credentials,
      project: 'stats-collector',
      tier: 'core',
    }),
  },

  server: {
    requires: ['listener', 'monitor', 'cfg', 'docs'],
    setup: async ({listener, monitor, cfg, docs}) => {
      // set up the various collectors
      require('./running')({monitor, listener});
      require('./pending')({monitor, listener});
      listener.start();
    },
  },

  // log tasks to console.log
  watch: {
    requires: ['listener'],
    setup: async ({listener}) => {
      listener.on('task-message', ({action, taskId}) => {
        console.log(action, taskId);
      });
      listener.start();
    },
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

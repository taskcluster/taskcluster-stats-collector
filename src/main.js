var TaskListener  = require('./listener.js');
var monitoring = require('taskcluster-lib-monitor');
let loader = require('taskcluster-lib-loader');
let docs = require('taskcluster-lib-docs');
let config = require('typed-env-config');
let collectorManager = require('./collectormanager');
let taskcluster = require('taskcluster-client');
let signalfx = require('signalfx');
import Clock from './clock';

collectorManager.setup();

let load = loader(Object.assign({
  cfg: {
    requires: ['profile'],
    setup: ({profile}) => config({profile}),
  },

  monitor: {
    requires: ['cfg'],
    setup: ({cfg}) => monitoring({
      project: 'tc-stats-collector',
      credentials: cfg.taskcluster.credentials,
      mock: process.env.NODE_ENV !== 'production',
    }),
  },

  listener: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => new TaskListener({
      credentials: cfg.pulse,
      routingKey: {}, // different in tests
    }),
  },

  clock: {
    requires: ['monitor'],
    setup: ({monitor}) => new Clock({monitor}),
  },

  queue: {
    requires: [],
    setup: () => new taskcluster.Queue(),
  },

  ingest: {
    requires: ['cfg'],
    setup: async ({cfg}) => new signalfx.Ingest(cfg.signalfx.apiToken),
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
    requires: ['collectors', 'docs'],
    setup: async ({collectors, docs}) => {
      collectorManager.start();
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
},
  // include a component for each collector
  collectorManager.components()),
  ['profile']);

// If this file is executed launch component from first argument
if (!module.parent) {
  load(process.argv[2], {
    profile: process.env.NODE_ENV,
  }).catch(err => {
    console.log(err.stack);
    process.exit(1);
  });
}

// Export load for tests
module.exports = load;

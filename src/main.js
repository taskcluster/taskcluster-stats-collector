const TaskListener  = require('./listener.js');
const monitoring = require('taskcluster-lib-monitor');
const pulse = require('taskcluster-lib-pulse');
const loader = require('taskcluster-lib-loader');
const docs = require('taskcluster-lib-docs');
const config = require('typed-env-config');
const collectorManager = require('./collectormanager');
const taskcluster = require('taskcluster-client');
const signalfx = require('signalfx');
const debugModule = require('debug');
const Clock = require('./clock');
const SignalFxRest = require('./signalfx-rest');
const yargs = require('yargs');

const argv = yargs
  .usage('Usage: $0 --collectors C')
  .describe('collectors', 'Collectors to run (default all)')
  .array('collectors')
  .argv;

collectorManager.setup(argv);

const load = loader(Object.assign({
  cfg: {
    requires: ['profile'],
    setup: ({profile}) => config({profile}),
  },

  monitor: {
    requires: ['cfg'],
    setup: ({cfg}) => monitoring({
      projectName: cfg.monitoring.project || 'tc-stats-collector',
      enable: cfg.monitoring.enable,
      rootUrl: cfg.taskcluster.rootUrl,
      credentials: cfg.taskcluster.credentials,
      mock: process.env.NODE_ENV !== 'production',
    }),
  },

  pulseClient: {
    requires: ['cfg', 'monitor'],
    setup: ({cfg, monitor}) => new pulse.Client({
      monitor,
      namespace: cfg.pulse.namespace,
      credentials: pulse.pulseCredentials(cfg.pulse),
    }),
  },

  listener: {
    requires: ['cfg', 'pulseClient'],
    setup: async ({cfg, pulseClient}) => new TaskListener({
      rootUrl: cfg.taskcluster.rootUrl,
      client: pulseClient,
      routingKey: {}, // different in tests
    }),
  },

  clock: {
    requires: ['monitor'],
    setup: ({monitor}) => new Clock({monitor}),
  },

  queue: {
    requires: ['cfg'],
    setup: ({cfg}) => new taskcluster.Queue({
      rootUrl: cfg.taskcluster.rootUrl,
    }),
  },

  ingest: {
    requires: ['cfg'],
    setup: ({cfg}) => {
      if (process.env.NODE_ENV !== 'production') {
        const fakeIngest = {};
        const debug = debugModule('signalfx-ingest');
        fakeIngest.send = req => {
          debug(JSON.stringify(req));
        };
        return fakeIngest;
      } else {
        return new signalfx.Ingest(cfg.signalfx.apiToken);
      }
    },
  },

  signalFxRest: {
    requires: ['cfg'],
    setup: ({cfg}) => new SignalFxRest(cfg.signalfx.apiToken),
  },

  docs: {
    requires: ['cfg'],
    setup: ({cfg}) => docs.documenter({
      credentials: cfg.taskcluster.credentials,
      tier: 'operations',
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
    argv,
    profile: process.env.NODE_ENV,
  }).catch(err => {
    console.log(err.stack);
    process.exit(1);
  });
}

// Export load for tests
module.exports = load;

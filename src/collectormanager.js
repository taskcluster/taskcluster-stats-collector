import path from 'path';
import fs from 'fs';
import debug from 'debug';
import {find} from 'lodash';
var EventEmitter = require('events');

/**
 * Manage a set of collectors.
 *
 * A collector is responsible for producing one or more metric time-series as
 * output.  As input, it might take in other time-series as input, or listen
 * for events of some sort, or poll some external resource.
 *
 * Collectors are "declared" to the collector manager, providing lots of metadata
 * on input sources and other requirements and the nature of the output.
 *
 * This has a few nice benefits:
 *  - the metadata can be made available to API consumers, allowing UI's that
 *    present an sensible organization to a sea of time-series
 *  - individual collectors can be run and tested in isolation
 *
 * Each collector is represented as a single tc-lib-loader component, with
 * requirements set appropriately.  This allows easy dependency injection for
 * testing, and minimizes the resources required for a test-run of a single
 * collector.
 */
class CollectorManager extends EventEmitter {
  constructor () {
    super();
    this.collectors = [];
  }

  /**
   * Load all collector implementations in collectors/*.js
   */
  setup () {
    fs.readdirSync(path.join(__dirname, 'collector')).forEach((f) => {
      if (f.endsWith('.js')) {
        require('./collector/' + f);
      }
    });
  }

  /**
   * Declare a collector
   *
   * Each file in collectors/*.js can call this one or more times to declare
   * collectors.  The available options are:
   *
   * {
   *    name: '..',     // name of the collector
   *    requires: [     // required loaded components, such as:
   *      'clock',      // ..utility for time-related functionality
   *      'queue',      // ..the TC queue client
   *      'monitor',    // ..the TC-lib-monitor instance
   *      'listener',   // ..a TaskListener
   *    ],              // see main.js for the full set
   * }
   *
   * The setup function is called with `this` bound to an object with props:
   *
   * {
   *    debug: ..,      // an instance of the debug module
   *    ..,             // any `options.requires` elements, included by name
   * }
   */
  collector (options, setup) {
    if (!options.name) {
      throw new Error('Collector must have a name');
    }
    if (find(this.collectors, {name: options.name})) {
      throw new Error('Collector must have a unique name');
    }
    options._fullname = `collector.${options.name}`;
    options._setup = setup;

    this.collectors.push(options);
  }

  /**
   * Get a set of tc-lib-loader components, one for each collector, plus
   * a `collectors` component that loads them all.
   */
  components () {
    // TODO: support only loading some, if process.env.COLLECTORS is set (for
    // use in development)
    const components = {
      collectors: {
        requires: this.collectors.map(({_fullname}) => _fullname),
        setup: () => null,
      },
    };

    this.collectors.forEach(options => {
      components[options._fullname] = {
        requires: options.requires,
        setup: dependencies => {
          dependencies.debug = debug(options._fullname);
          dependencies.debug('setting up');
          return options._setup.call(dependencies);
        },
      };
    });

    return components;
  }

  /**
   * Start collection.
   *
   * This emits a `started` event which other components can listen for.  When
   * this event is emitted, all collectors are set up and ready to accept events.
   */
  start () {
    this.emit('started', {});
  }
}

module.exports = new CollectorManager();

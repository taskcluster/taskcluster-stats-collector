import path from 'path';
import fs from 'fs';
import debug from 'debug';
var EventEmitter = require('events');

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
   * collectors.
   */
  collector (options, setup) {
    if (!options.name) {
      throw new Error('Collector must have a name');
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
          return options._setup(dependencies);
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

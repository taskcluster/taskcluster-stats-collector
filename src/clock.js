import debugModule from 'debug';
import _ from 'lodash';

const debug = debugModule('clock');

class Clock {
  constructor ({monitor}) {
    this.monitor = monitor;
  }

  // Return the current time in milliseconds
  msec () {
    return new Date().getTime();
  }

  // Run fn at the given time
  // TODO: test
  at (name, when, fn) {
    let delay = when - new Date();
    if (delay < 0) {
      delay = 0;
    }

    setTimeout(async () => {
      debug('Running ' + name);
      try {
        await fn();
      } catch (err) {
        this.monitor.reportError(err);
        console.log('%s failed: %s', name, err);
      }
    }, delay);
  }

  // Run fn periodically, whether async or not, surviving errors
  periodically (interval, name, fn) {
    setTimeout(async () => {
      while (true) {
        debug('Running ' + name);
        try {
          await fn();
        } catch (err) {
          this.monitor.reportError(err);
          console.log('%s failed: %s', name, err);
        }
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }, interval);
  }

  // like lodash's throttle, but without throttling tests
  throttle () {
    return _.throttle.apply(_, arguments);
  }
};

export default Clock;

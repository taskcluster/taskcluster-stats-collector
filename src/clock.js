import debugModule from 'debug';

const debug = debugModule('clock');

class Clock {
  constructor ({monitor}) {
    this.monitor = monitor;
  }

  // Return the current time in milliseconds
  msec () {
    return new Date().getTime();
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
};

export default Clock;

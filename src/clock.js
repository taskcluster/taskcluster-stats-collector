import debugModule from 'debug';
import _ from 'lodash';

const debug = debugModule('clock');

class Clock {
  constructor ({monitor}) {
    this.monitor = monitor;
    this._stop = false;
  }

  /**
   * Return the current time in milliseconds
   */
  msec () {
    return new Date().getTime();
  }

  async _runFunction (name, fn) {
    debug(`Running '${name}'`);
    try {
      await fn();
    } catch (err) {
      this.monitor.reportError(err);
      debug(`'${name}' failed: ${err}`);
    }
  }

  /**
   * Like the global `setTimeout`, but with logging and handling for async
   * errors.  Note that this does not return a timeout ID and cannot be
   * cancelled (but that functionality can be added if needed!)
   */
  setTimeout (name, fn, delay) {
    setTimeout(() => this._runFunction(name, fn), delay);
  }

  /**
   * Run fn periodically, whether async or not, surviving errors
   */
  periodically (interval, name, fn) {
    setTimeout(async () => {
      while (!this._stop) {
        await this._runFunction(name, fn);
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }, interval);
  }

  /**
   * Exactly like lodash's throttle.
   *
   * (this exists just to avoid throttling in tests)
   */
  throttle () {
    return _.throttle.apply(_, arguments);
  }
};

export default Clock;

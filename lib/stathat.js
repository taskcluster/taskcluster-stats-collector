let got = require('got');
let _ = require('lodash');
let events = require('events');
let debug = require('debug')('stathat');
let assert = require('assert');

class StatHat extends events.EventEmitter {
  constructor(options = {}) {
    super();

    options = _.defaults({}, options, {
      mock: false,
      prefix: '',
      maxCache: 100,
      maxDelay: 1 * 60 * 1000,
    });
    if (options.mock) {
      this.count = () => {};
      this.value = () => {};
      this.flush = () => { return Promise.resolve(); };
      return;
    }
    assert(typeof(options.ezKey) === 'string', 'ezKey is required');
    assert(typeof(options.prefix) === 'string', 'prefix must be a string');
    assert(typeof(options.maxCache) === 'number', 'maxCache must be a number');
    assert(typeof(options.maxDelay) === 'number', 'maxDelay must be a number');
    this._options = options;
    this._data = [];
    this._flushTimer = null;
    this.flush();
  }

  count(name, count = 1, time = new Date()) {
    debug('count(%s, %d, %j)', name, count, time);
    assert(typeof(name) === 'string', 'name must be a string');
    assert(typeof(count) === 'number', 'count must be a number');
    assert(time instanceof Date, 'time must be a Date object');
    let length = this._data.push({
      stat: this._options.prefix + name,
      count: count,
      t: time.getTime() / 1000,
    });
    if (length > this._options.maxCache) {
      this.flush();
    }
  }

  value(name, value, time = new Date()) {
    debug('count(%s, %d, %j)', name, value, time);
    assert(typeof(name) === 'string', 'name must be a string');
    assert(typeof(value) === 'number', 'value must be a number');
    assert(time instanceof Date, 'time must be a Date object');
    let length = this._data.push({
      stat: this._options.prefix + name,
      value: value,
      t: time.getTime() / 1000,
    });
    if (length > this._options.maxCache) {
      this.flush();
    }
  }

  async flush() {
    // Clear timer
    clearTimeout(this._flushTimer);
    this._flushTimer = null;

    // Take data
    let data = this._data;
    this._data = [];

    debug('flush: Sending %d data-points', data.length);

    // Send request
    let res = await got('https://api.stathat.com/ez', {
      method: 'post',
      headers: {
        'content-type': 'application/json'
      },
      encoding: 'utf8',
      body: JSON.stringify({
        ezkey: this._options.ezKey,
        data: data,
      }),
      timeout: 30 * 1000,
      retries: 5,
    });

    // TODO: Handle any errors, conflicting stats types, and HTTP errors
    // these should cause an 'error' event to be emitted.

    // Set timer again
    this._flushTimer = setTimeout(() => this.flush(), this._options.maxDelay);
  }
};

module.exports = StatHat;
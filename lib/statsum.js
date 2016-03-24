let got = require('got');
let _ = require('lodash');
let debug = require('debug')('statsum');
let assert = require('assert');
let jwt = require('jwt-simple');

export default class Statsum {
  constructor(options = {}) {
    options = _.defaults({}, options, {
      mock: false,
      maxDelay: 1 * 60 * 1000,
    });
    if (options.mock) {
      this.count = () => {};
      this.value = () => {};
      this.flush = () => { return Promise.resolve(); };
      return;
    }
    assert(typeof options.secret === 'string', 'JWT secret is required');
    assert(typeof options.project === 'string', 'project must be a string');
    assert(typeof options.maxDelay === 'number', 'maxDelay must be a number');

    this.token = jwt.encode({
      project: options.project,
      exp: Math.floor((Date.now() + 72 * 60 * 60 * 1000)/1000),
    }, options.secret, 'HS256');
    this.baseURL = 'https://statsum.taskcluster.net';
    this._options = options;
    this._data = {ValueMetrics: {}, CountMetrics: {}};
    this._flushTimer = null;
    this.flush();
  }

  count(name, count = 1) {
    debug('count(%s, %d)', name, count);
    assert(typeof name === 'string', 'name must be a string');
    assert(typeof count === 'number', 'count must be a number');
    if (!Object.keys(this._data.CountMetrics).includes(name)) {
      this._data.CountMetrics[name] = 0;
    }

    this._data.CountMetrics[name] += 1;
  }

  value(name, value) {
    debug('count(%s, %d)', name, value);
    assert(typeof name === 'string', 'name must be a string');
    assert(typeof value === 'number', 'value must be a number');
    if (!Object.keys(this._data.ValueMetrics).includes(name)) {
      this._data.ValueMetrics[name] = [];
    }
    this._data.ValueMetrics[name].push(value);
  }

  async flush() {
    clearTimeout(this._flushTimer);
    this._flushTimer = null;
    let nmetrics = Object.keys(this._data.CountMetrics).length + Object.keys(this._data.ValueMetrics).length;
    if (nmetrics === 0) {
      debug('no data to send');
      this._flushTimer = setTimeout(() => this.flush(), this._options.maxDelay);
      return;
    }

    // Take data
    let data = this._data;
    this._data = {ValueMetrics: {}, CountMetrics: {}};
    let payload = {valueMetrics: [], countMetrics: []};
    Object.keys(data.ValueMetrics).forEach((k) => {
      payload.valueMetrics.push({k: k, v: data.ValueMetrics[k]});
    });
    Object.keys(data.CountMetrics).forEach((k) => {
      payload.countMetrics.push({k: k, v: data.CountMetrics[k]});
    });

    debug('flush: Sending %d data-points', nmetrics);
    debug(JSON.stringify(payload, null, 2));

    // Send request
    let res;
    try {
      res = await got(`${this.baseURL}/data/${this._options.project}`, {
        method: 'post',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        encoding: 'utf8',
        json: true,
        body: JSON.stringify(payload),
        timeout: 30 * 1000,
        retries: 5,
      });
    } catch(e) {
      debug(e);
    }

    debug('finished flushing');

    // TODO: Handle any errors, conflicting stats types, and HTTP errors
    // these should cause an 'error' event to be emitted.

    // Set timer again
    this._flushTimer = setTimeout(() => this.flush(), this._options.maxDelay);
  }
}

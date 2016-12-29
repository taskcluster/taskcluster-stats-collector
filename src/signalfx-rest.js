import request from 'requestretry';

/**
 * A simple interface to the SignalFX REST API, since signalfx-nodejs does not
 * supply one.
 */

export default class SignalFxRest {
  constructor (api_token) {
    this.api_token = api_token;
  }

  /**
   * Call /timeserieswindow
   *
   * options:
   * {
   *   query,      // see https://developers.signalfx.com/docs/timeserieswindow
   *   startMs,
   *   endMs,
   *   resolution,
   * }
   *
   * Note that the resolution must be one of the whitelisted resolution values or
   * you will get an error (or just no data).
   */
  async timeserieswindow ({query, startMs, endMs, resolution}) {
    const qs = `query=${encodeURIComponent(query)}&startMs=${startMs}&endMs=${endMs}&resolution=${resolution}`;
    const url = `https://api.signalfx.com/v1/timeserieswindow?${qs}`;

    const res = await request.get({
      url,
      json: true,
      headers: {
        'Content-Type': 'application/json',
        'X-SF-Token': this.api_token,
      },
      maxAttempts: 5,
      retryDelay: 2000,
      retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
    });

    if (res.statusCode != 200) {
      const err = new Error(`Error from signalfx: HTTP ${res.statusCode}, ${JSON.stringify(res.body)}`);
      err.statusCode = res.statusCode;
      throw err;
    }

    // data is helpfully keyed by a random string, or more than one if there were
    // multiple matching time series.. but no information about which time series
    // is which.
    const data = res.body.data;
    const keys = Object.keys(data);
    if (keys.length > 1) {
      throw new Error(`multiple time-series returned for query ${query}`);
    } else if (keys.length == 0) {
      // The quarter-baked SignalFx API helpfully returns "200 OK" for errors.
      if (res.body.errors.length) {
        throw new Error(res.body.errors[0].message);
      }
      return [];
    }
    return data[keys[0]];
  }
};

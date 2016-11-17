import {Writable} from 'stream';
import from from 'from';
import _ from 'lodash';
import debugModule from 'debug';

const HOUR = 1000 * 60 * 60;

/**
 *
 * A metric stream is an object stream that produces data points from the given
 * metric, starting at the given time and continuing on until it runs "live".
 *
 * The stream objects are datapoints:
 * {
 *   ts,      // milliseconds
 *   value,   // value of the datapoint at ts
 *   live,    // true if this is a "live" datapoint (not historical)
 * }
 *
 * Note that "live" datapoints may still have a delay of a few seconds (that is,
 * `ts` may be a few seconds in the past) due to message propagation delays, polling,
 * etc.
 *
 * Metric streams emit a "live" message and set their `live` property true
 * after the last historical datapoint has been pushed into the stream.  Note
 * that events and stream data are not synchronized, so this event may arrive
 * before all buffered historical data is consumed.
 */

const RESOLUTIONS = {
  '5s': 5 * 1000,
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

/**
 * Return a metric stream for the metric identified by the given query, starting
 * at `start` and with the given resolution.  The `clock` and `signalFxRest` options
 * should come from the loader components of the same name.
 *
 * Resolution must be one of `5s`, `1m`, `5m`, '1h'.
 */
export const signalFxMetricStream = ({query, resolution, start, clock, signalFxRest}) => {
  let latestDatapoint = start;
  let liveData = false;

  // see comments on waking up to query the next datapoint, below
  const DELAY_REDUCTION = 100;
  const BACKOFF_START = 500;
  const BACKOFF_FACTOR = 1.5;
  let delay = 1000; // starting guess
  let backoff = BACKOFF_START;

  const resolutionMs = RESOLUTIONS[resolution];
  if (!resolutionMs) {
    throw new Error(`invalid resolution ${resolution}`);
  }

  const fetch = async function () {
    const now = clock.msec();

    // start back a few seconds to allow slop on signalFx's side
    let startMs = latestDatapoint - 5000; 

    let endMs = latestDatapoint + HOUR;
    if (endMs > now) {
      endMs = now;
    }

    (await signalFxRest.timeserieswindow({
      query: query,
      startMs, endMs,
      resolution: resolutionMs,
    })).forEach(dp => {
      // skip if we've seen this datapoint before
      if (dp[0] <= latestDatapoint) {
        return;
      }
      latestDatapoint = dp[0];
      this.emit('data', {ts: dp[0], value: dp[1], live: liveData});
      if (liveData) {
        delay = now - latestDatapoint;
        backoff = BACKOFF_START;
      }
    });

    // if we are up to the current time, then remaining samples will be "live"
    if (endMs === now) {
      if (!liveData) {
        this.live = true;
        this.emit('live');
      }
      liveData = true;
    }

    // if we're live and there's no more deta, assume the next datapoint will
    // be here about the resolution + delay after the last datapoint; failing
    // that, poll with a slow backoff.  This should occasionally re-try quickly,
    // as that is the only way to reduce the delay.  This is a guessing game,
    // but is pretty key to getting timely results.
    if (liveData) {
      const wakeup = latestDatapoint + resolutionMs + delay - DELAY_REDUCTION;
      this.pause();
      // TODO: clock.at
      setTimeout(() => this.resume(), (wakeup > now) ? wakeup - now : backoff);
      backoff = backoff * 1.5;
    }
  };

  const stream = from(function (count, next) {
    let errBackoff = 60000;
    fetch.call(this)
      .catch(err => {
        // on error, report the error and back off
        stream.pause();
        stream.emit('error', err);
        // TODO: clock.at
        setTimeout(() => this.resume(), errBackoff);
        errBackoff = errBackoff * 2;
      })
      .then(() => { errBackoff = 60000; })
      .then(next);
  });
  stream.live = false;

  return stream;
}

/**
 * A writable stream that logs a metric stream to the console.
 */
export const metricLoggerStream = (prefix) => {
  return new Writable({
    objectMode: true,
    write: (chunk, enc, next) => {
      const delay = new Date() - chunk.ts;
      console.log("%s: @%s: %s (%s; delayed %ss)",
        prefix,
        new Date(chunk.ts),
        chunk.value,
        chunk.live ? "live" : "historical",
        chunk.live ? delay / 1000 : '-');
      next();
    },
  });
}

/**
 * Multiplex several metric streams into a single metric stream.  The
 * resulting stream will have a datapoint for every unique timestamp
 * in the input streams, but critically the values of those datapoints
 * will be an array of the most recent input datapoint for each input
 * stream at that time.
 *
 * The delay of the output stream will be greater than the maximum delay of any
 * of the input streams.  This can cause data points to be missed when they
 * arrive much later than expected.
 *
 * There is a "warm-up" period when the stream first starts, while it waits
 * for historical data from all input streams.  During this time, all historical
 * datapoints are buffered -- be careful of memory usage here!
 *
 * The `streams` option is the array of input streams:
 * [
 *   {stream: <readable stream>, name: stream name},
 *   ...
 * ]
 *
 * The remaining options are loader components.
 */
export const multiplexMetricStreams = ({streams, clock}) => {
  const debug = debugModule('metricstream.multiplexMetricStreams');
  let vtime = 0;
  let warm = false;

  const output = from(function (count, next) { });
  output.live = false;

  const inputs = streams.map(({stream, name}) => {
    const input = {
      stream,
      name,
      datapoints: [],
      _delays: [],
      delay: 1000, // starting guess
      value: undefined,
      live: false, // true if we have *read* a live datapoint
    };

    stream.on('live', () => {
      if (!warm && _.all(inputs, s => s.stream.live)) {
        debug('warmed - all input streams are now live');
        warm = true;
      }
      update();
    });

    const wr = new Writable({
      objectMode: true,
      write: (chunk, enc, next) => {
        if (chunk.ts < vtime) {
          debug('discarding late datapoint %s at %s from stream %s',
              chunk.value, chunk.ts, name);
        }
        input.datapoints.push(chunk);

        // update delay for live datapoints using a simple moving average
        if (chunk.live) {
          input._delays.push(clock.msec() - chunk.ts);
          input.delay = _.sum(input._delays) / input._delays.length;
          while (input._delays.length > 3) {
            input._delays.shift();
          }
        }

        update();
        next();
      },
    });
    stream.pipe(wr);

    return input;
  });

  // update the output stream based on input streams, until running
  // out of data.  It's safe to call this whenever the input conditions
  // change; it is properly debounced so that it will not actually run
  // too often.
  const update = clock.throttle(() => {
    // no updates at all until everything is warm
    if (!warm) {
      return;
    }

    // update the output by advancing the virtual `vtime` to each successive
    // timestamp appearing in any input stream, remaining at least `delay`
    // seconds before the current wall time to allow lagging datapoints to
    // come in.
    while (true) {
      const now = clock.msec();
      
      // applied delay is 10% more than the largest input delay, plus 500ms
      const delay = _.max(inputs.map(i => i.delay)) * 1.1 + 500;
      debug("applied delay is %ss", delay / 1000);

      // calculate the next vtime, and bail out if we're not ready yet, planning
      // to return when the time is right
      const nextTs = _.min(inputs.map(i => i.datapoints[0] && i.datapoints[0].ts));
      if (nextTs > now - delay) {
        if (nextTs !== Infinity) {
          setTimeout(update, nextTs - (now - delay));
        }
        break;
      }

      debug("advancing vtime from %s to %s", vtime, nextTs);
      inputs.forEach(input => {
        if (input.datapoints[0] && input.datapoints[0].ts <= nextTs) {
          const dp = input.datapoints.shift();
          input.latest = dp.value;
          input.live = dp.live;
        }
      });

      let live;
      if (output.live) {
        live = true;
      } else {
        live = _.all(inputs.map(i => i.live));
        if (live) {
          output.emit('live');
          output.live = true;
        }
      }
      output.emit('data', {ts: nextTs, value: inputs.map(i => i.latest), live});
      vtime = nextTs;
    }

  }, 500, {leading: false, trailing: true});

  return output;
};

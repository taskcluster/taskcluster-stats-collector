import {Writable} from 'stream';
import sculpt from 'sculpt';
import {Readable} from 'stream';
import _ from 'lodash';
import debugModule from 'debug';
import RESOLUTIONS from './resolutions';

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
 * Metric streams emit a "live" event and set their `live` property true
 * after the last historical datapoint has been pushed into the stream.  Note
 * that events and stream data are not synchronized, so this event may arrive
 * before all buffered historical data is consumed.
 *
 * NOTE: the "through" streams here will not pass along the live event and property.
 */

/**
 * Return a metric stream for the metric identified by the given query, starting
 * at `start` and with the given resolution.  The `clock` and `signalFxRest` options
 * should come from the loader components of the same name.
 *
 * Resolution must be one of `5s`, `1m`, `5m`, '1h'.
 */
export const signalFxMetricStream = ({query, resolution, start, clock, signalFxRest}) => {
  let latestDatapoint = start - 1;  // -1 to capture a datapoint at start
  let liveData = false;

  // NOTE: SignalFx's quantizer delays incoming data by its resolution; that
  // is, at 5m resolution you won't see a datapoint until the next multiple of
  // 5 minutes -- acutally a bit later.  Resolutions are calculated based on
  // the incoming data, not on the requested resolution.
  const QUANTIZER_DELAY = 15000;

  const resolutionMs = RESOLUTIONS[resolution];
  if (!resolutionMs) {
    throw new Error(`invalid resolution ${resolution}`);
  }

  let output;
  let DBG = debugModule(`sFMS.${query}`);
  const fetch = () => {
    (async function () {
      const now = clock.msec();

      let startMs = latestDatapoint;
      let endMs = now;

      DBG(`call timeserieswindow with ${startMs} ${endMs} ${resolutionMs}`);
      (await signalFxRest.timeserieswindow({
        query: query,
        startMs, endMs,
        resolution: resolutionMs,
      })).forEach(dp => {
        DBG(`got ${JSON.stringify(dp)}`);
        // skip if we've seen this datapoint before
        if (dp[0] <= latestDatapoint) {
          return;
        }
        latestDatapoint = dp[0];
        output.emit('data', {ts: dp[0], value: dp[1], live: liveData});
      });

      // if we are up to the current time, then remaining samples will be "live"
      if (endMs === now) {
        if (!liveData) {
          output.live = true;
          output.emit('live');
        }
        liveData = true;
      }

      // If we're live and there's no more data, assume the next datapoint will
      // be here at the next even interval of the resolution, or shortly thereafter.
      if (liveData) {
        let wakeup = now + resolutionMs;  // go to the next resolution bin
        wakeup -= wakeup % resolutionMs;  // round down to the beginning of the bin
        wakeup += QUANTIZER_DELAY;        // and wait for the quantizer to write out the data

        clock.setTimeout(`fetch next datapoint for ${query}`,
            fetch, wakeup > now ? wakeup - now : 0);
      } else {
        // still historical, so query right away
        process.nextTick(fetch);
      }
    })().catch(err => {
      output.emit('error', err);
      clock.setTimeout(`retry fetch ${query} after error`, fetch, 10000);
    });
  };

  let started = false;

  output = new Readable({read: () => {
    // start pushing
    if (!started) {
      started = true;
      fetch();
    }
    // always pause, as this is a push (non-flowing) stream
    output.pause();
  }});
  output.live = false;

  return output;
};

/**
 * A through stream that logs a metric stream to the console; options:
 *
 *  {
 *    prefix: logging prefix,
 *    log: logging function (default console.log),
 *    clock: clock object for calculating delay (optional)
 *  }
 */
export const metricLoggerStream = ({prefix, log, clock}) => {
  const _prefix = prefix ? `${prefix}: ` : '';
  const _log = log || console.log;
  const msec = () => clock && clock.msec() || +new Date();

  return sculpt.tap((chunk) =>
    _log(`${_prefix}ts=${chunk.ts}: ${chunk.value} ` +
         (chunk.live ? `(live, ${(msec() - chunk.ts) / 1000}s delay)` : '(historical)'))
  );
};

/**
 * A through stream that logs a metric stream directly to SignalFx.
 *
 * options: {
 *   metric: // metric name
 *   type: // metric type ('gauge', 'cumulative_counter', or 'counter')
 *   ingest: // Ingest object from the SignalFx client
 * }
 */
export const signalFxIngester = ({metric, type, ingest}) => {
  const plurals = {
    gauge: 'gauges',
    cumulative_counter: 'cumulative_counters',
    counter: 'counters',
  };
  if (!plurals[type]) {
    throw new Error(`Unknown metric type ${type}`);
  }

  return sculpt.tap((chunk) => {
    const req = {};
    req[plurals[type]] = [{
      metric,
      value: Math.round(chunk.value),
      timestamp: chunk.ts,
    }];
    ingest.send(req);
  });
};

/**
 * A simple stream that sinks all data.  Use this to terminate a sequence
 * of through streams.
 */
export const sinkStream = () => {
  return new Writable({
    objectMode: true,
    write: (chunk, enc, next) => next(),
  });
};

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
 * options: {
 *    name: name of the multiplexed stream,
 *    streams: input streams,
 *    clock: the clock component
 *  }
 *
 * The `streams` option is the array of input streams:
 * [
 *   {stream: <readable stream>, name: stream name},
 *   ...
 * ]
 */
export const multiplexMetricStreams = ({name, streams, clock}) => {
  const debug = debugModule(`multiplexMetricStreams.${name || 'unnamed'}`);
  let vtime = 0;
  let warm = false;

  // output is a readable stream, but with no read method (so, only operating in pull mode)
  const output = new Readable({objectMode: true, read: function () { this.pause(); }});
  output.live = false;

  const inputs = streams.map(({stream, name}) => {
    const input = {
      stream,
      name,
      datapoints: [],
      _delays: [],
      delay: 1000, // starting guess
      value: undefined,
      // true if we have *udpated to* a live datapoint, which may occur after
      // we get the 'live' event from this input
      live: false,
    };

    stream.on('live', () => {
      if (!warm && _.all(inputs, s => s.stream.live)) {
        debug('warmed up: all input streams are now live');
        warm = true;
      }
      update();
    });

    stream.on('data', (chunk) => {
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
    });

    return input;
  });

  // update the output stream based on input streams, until running
  // out of data.  It's safe to call this whenever the input conditions
  // change, as it is properly debounced so that it will not actually run
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

      // applied delay is 12.5% more than the largest input delay, plus 500ms
      const inputDelay = _.max(inputs.map(i => i.delay));
      const delay = inputDelay + (inputDelay >> 3) + 500;

      // calculate the next vtime, and bail out if we're not ready yet, planning
      // to return when the time is right
      const nextTs = _.min(inputs.map(i => i.datapoints[0] && i.datapoints[0].ts));
      if (nextTs > now - delay) {
        if (nextTs !== Infinity) {
          clock.setTimeout(`update ${name || 'unnamed mux'}`, update, nextTs - (now - delay));
        }

        // we're now live, even if some inputs have yet to produce any live
        // datapoints
        if (!output.live) {
          output.emit('live');
          output.live = true;
        }
        break;
      }

      inputs.forEach(input => {
        if (input.datapoints[0] && input.datapoints[0].ts <= nextTs) {
          const dp = input.datapoints.shift();
          input.latest = dp.value;
          input.live = dp.live;
        }
      });

      let live = output.live;
      if (!live) {
        live = _.all(inputs.map(i => i.live));
        if (live) {
          output.live = true;
          output.emit('live');
        }
      }
      output.emit('data', {ts: nextTs, value: inputs.map(i => i.latest), live});
      vtime = nextTs;
    }

  }, 500, {leading: false, trailing: true});

  return output;
};

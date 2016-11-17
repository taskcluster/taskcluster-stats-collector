import RESOLUTIONS from './resolutions';
import collectorManager from './collectormanager';
import sculpt from 'sculpt';
import _ from 'lodash';
import {
  signalFxMetricStream,
  signalFxIngester,
  multiplexMetricStreams,
  metricLoggerStream,
} from './metricstream';

/**
 * Declare an SLO, a service level objective.  This will declare and implement
 * a collector based on the options.
 *
 * A service level objective defines thresholds for a collection of SLIs.  If
 * any of the thresholds are exceeded, the objective is not met and emits 0 (false).
 * Otherwise, it emits 1.
 *
 * options: {
 *  name: '..',  // SLO name (collector name will add an 'slo' prefix)
 *  description: '..',  // description of the SLO, for documentation
 *  requires: [..], // any additional loader components required
 *  indicators: [{
 *    sli: '..',        // SLI name
 *    resolution: '..', // resolution of the SLI (its shortest underlying resolution)
 *    met: v => ..,     // function to determine if the objective is met for this SLI,
 *                      // given the value of the SLI
 *  }, {
 *    ...
 *  }]
 * }
 */

exports.declare = ({name, description, requires, indicators}) => {
  collectorManager.collector({
    name: `slo.${name}`,
    description,
    requires: ['monitor', 'clock', 'signalFxRest', 'ingest'].concat(requires || []),
  }, async function () {
    const inputSources = indicators.map(({sli, resolution}) => {
      const resolutionMs = RESOLUTIONS[resolution];
      const stream = signalFxMetricStream({
        query: `sf_metric:sli.${sli}`,
        resolution: resolution,
        // go back two resolutions, hoping to span any outages
        start: this.clock.msec() - 2 * resolutionMs,
        clock: this.clock,
        signalFxRest: this.signalFxRest,
      });
      return {name: sli, stream};
    });

    // multiplex those streams together
    const muxStream = multiplexMetricStreams({
      name: `slo.${name}.mux`,
      streams: inputSources,
      clock: this.clock,
    });

    // transform it with the aggregate function
    const aggregateStream = sculpt.filter(dp => {
      if (_.all(dp.value.map((value, i) => indicators[i].met(value)))) {
        // all objectives met -> SLO = 1
        dp.value = 1;
      } else {
        dp.value = 0;
      }
      return dp;
    });

    // ingest the result
    const ingestStream = signalFxIngester({
      metric: `slo.${name}`,
      type: 'gauge',
      ingest: this.ingest,
    });

    // and log it
    const logStream = metricLoggerStream({
      prefix: 'write datapoint',
      log: msg => this.debug(msg),
      clock: this.clock,
    });

    // add logs to each input, too
    inputSources.forEach(src => {
      src.stream.pipe(metricLoggerStream({
        prefix: `received from ${src.name}`,
        log: msg => this.debug(msg),
        clock: this.clock,
      }));
    });

    // handle errors from any of those streams..
    const handleStreamError = ({stream, name}) => {
      stream.on('error', err => {
        this.monitor.reportError(err);
        this.debug(`error from stream ${name}: ${err}`);
      });
    };
    inputSources.forEach(handleStreamError);
    handleStreamError({stream: muxStream, name: 'muxStream'});
    handleStreamError({stream: aggregateStream, name: 'aggregateStream'});
    handleStreamError({stream: ingestStream, name: 'ingestStream'});
    handleStreamError({stream: logStream, name: 'logStream'});

    // and pipe them together
    muxStream.pipe(aggregateStream).pipe(ingestStream).pipe(logStream);
  });
};


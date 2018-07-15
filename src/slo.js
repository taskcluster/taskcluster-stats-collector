const RESOLUTIONS = require('./resolutions');
const collectorManager = require('./collectormanager');
const sculpt = require('sculpt');
const _ = require('lodash');
const {
  signalFxMetricStream,
  signalFxIngester,
  multiplexMetricStreams,
  metricLoggerStream,
  aggregateMetricStream,
  sinkStream,
} = require('./metricstream');

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

exports.declare = ({name, description, requires, indicators, testOnly}) => {
  collectorManager.collector({
    name: `slo.${name}`,
    description,
    requires: ['monitor', 'clock', 'signalFxRest', 'ingest'].concat(requires || []),
    testOnly,
  }, async function() {
    const inputSources = indicators.map(({sli, resolution}) => {
      const resolutionMs = RESOLUTIONS[resolution];
      const stream = signalFxMetricStream({
        query: `sf_metric:sli.${sli}`,
        resolution: resolution,
        // go back two resolutions, hoping to span any outages
        start: this.clock.msec() - 2 * resolutionMs,
        clock: this.clock,
        signalFxRest: this.signalFxRest,
      })
      // log that input
        .pipe(metricLoggerStream({
          prefix: `received from ${sli}`,
          log: msg => this.debug(msg),
          clock: this.clock,
        }));
      return {name: sli, stream};
    });

    // multiplex those streams together
    const muxStream = multiplexMetricStreams({
      name: `slo.${name}.mux`,
      streams: inputSources,
      clock: this.clock,
    });

    // transform it with the aggregate function
    const aggregateStream = aggregateMetricStream({
      aggregate: values => {
        if (_.every(values.map((value, i) => indicators[i].met(value)))) {
          // all objectives met -> SLO = 1
          return 1;
        }
        return 0;
      },
    });

    // ingest the result
    const ingestStream = signalFxIngester({
      metric: `slo.${name}`,
      type: 'gauge',
      ingest: this.ingest,
    });

    // log it
    const logStream = metricLoggerStream({
      prefix: 'write datapoint',
      log: msg => this.debug(msg),
      clock: this.clock,
    });

    // and sink it
    const sink = sinkStream();

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
    muxStream.pipe(aggregateStream).pipe(ingestStream).pipe(logStream).pipe(sink);
  });
};

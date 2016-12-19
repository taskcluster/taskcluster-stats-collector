import RESOLUTIONS from './resolutions';
import collectorManager from './collectormanager';
import sculpt from 'sculpt';
import {
  signalFxIngester,
  signalFxMetricStream,
  multiplexMetricStreams,
  metricLoggerStream,
} from './metricstream';

/**
 * Declare an SLI, a service level indicator.  This will declare and implement
 * a collector based on the options.
 *
 * options: {
 *  name: '..',         // SLI name (collector name will include an 'sli' prefix)
 *  description: '..',  // description of the SLI, for documentation
 *  requires: [..],     // any additional loader components required
 *  inputs: [..]        // input metric stream specs
 *    OR:
 *  inputs: async function() { ..; return [..]; }`
 *  aggregate: ([v0, v1, ..]) => v,  // function to aggregate inputs into output
 * }
 *
 * Stream specs can have any of the following forms:
 *
 * // metrics input directly into signalFx:
 * {spec: 'signalfx', metric: 'bugzilla.intermittents', resolution: '1h'}
 *
 * // metrics submitted via statsum
 * {spec: 'statsum', metric: 'taskcluster-auth.api.azureTableSAS.all',
 *  percentile: 95, resolution: '1h'}
 */

exports.declare = ({name, description, requires, inputs, aggregate, testOnly}) => {
  collectorManager.collector({
    name: `sli.${name}`,
    description,
    requires: ['monitor', 'clock', 'signalFxRest', 'ingest'].concat(requires || []),
    testOnly,
  }, async function () {
    let inputSpecs;
    if (typeof inputs === 'function') {
      inputSpecs = await inputs.call(this);
    } else {
      inputSpecs = inputs;
    }

    const inputSources = inputSpecs.map(spec => sourceFromSpec(spec, this));

    // multiplex those streams together
    const muxStream = multiplexMetricStreams({
      name: `sli.${name}.mux`,
      streams: inputSources,
      clock: this.clock,
    });

    // transform it with the aggregate function
    const aggregateStream = sculpt.filter(dp => {
      dp.value = aggregate.call(this, dp.value);
      return dp;
    });

    // ingest the result
    const ingestStream = signalFxIngester({
      metric: `sli.${name}`,
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

/**
 * Given a "stream spec", return a name and metric stream.
 *
 * The return value is in the format {name, stream}.
 */
const sourceFromSpec = (spec, components) => {
  const specType = spec.spec;
  if (specType === 'signalfx') {
    const {metric, resolution} = spec;
    const resolutionMs = RESOLUTIONS[resolution];

    if (!metric || !resolution || !resolutionMs) {
      throw new Error(`invalid stream spec ${spec}`);
    }

    return {
      name: metric,
      stream: signalFxMetricStream({
        query: `sf_metric:${metric}`,
        resolution: resolution,
        // go back far enough to get some history..
        start: components.clock.msec() - 2 * resolutionMs,
        clock: components.clock,
        signalFxRest: components.signalFxRest,
      }),
    };
  } else if (specType === 'statsum') {
    const {metric, resolution, percentile} = spec;
    return sourceFromSpec({
      spec: 'signalfx',
      metric: `${metric}.${resolution}.p${percentile}`,
      resolution,
    }, components);
  } else {
    throw new Error(`unknown stream spec type ${specType}`);
  }
};

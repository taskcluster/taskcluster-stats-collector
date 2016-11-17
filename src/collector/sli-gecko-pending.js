import collectorManager from '../collectormanager';
import {Transform} from 'stream';
import {signalFxMetricStream, metricLoggerStream, multiplexMetricStreams} from '../metricstream';
import _ from 'lodash';

const HOUR = 1000 * 60 * 60;
const FIVE_MINUTE = 1000 * 5 * 60;

const TEST_WORKERTYPES = [
  'desktop-test',
  'desktop-test-large',
  'desktop-test-xlarge',
];

const maxTransform = () => new Transform({
  objectMode: true,
  transform(chunk, enc, callback) {
    chunk.value = _.max(chunk.value);
    callback(null, chunk);
  },
});

collectorManager.collector({
  name: 'sli.gecko.pending.test',
  requires: ['monitor', 'clock', 'signalFxRest'],
  // support emitting via statsum or directly as a time series
}, function () {
  const inputs = TEST_WORKERTYPES.map(workerType => {
    return {
      name: workerType,
      stream: signalFxMetricStream({
        query: `sf_metric:tc-stats-collector.tasks.aws-provisioner-v1.${workerType}.pending.5m.p95`,
        resolution: '5m',
        start: this.clock.msec() - 600 * 1000, // get some history; TODO: go as far back as required to backfill
        clock: this.clock,
        signalFxRest: this.signalFxRest,
      }),
    };
  });

  inputs.forEach(s => s.stream.on('error', err => console.error(err)));

  // multiplex those streams together
  const mux = multiplexMetricStreams({
    streams: inputs,
    clock: this.clock,
  });

  // transform it by taking the maximum
  const max = maxTransform();
  mux.pipe(max);

  // and log the result
  max.pipe(metricLoggerStream('mux'));
});

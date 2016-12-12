import assume from 'assume';
import debugModule from 'debug';
import {
  FakeSignalFxRest,
  FakeClock,
  MetricStreamSource,
  MetricStreamSink,
  nextTick,
} from './helper';
import {
  signalFxMetricStream,
  metricLoggerStream,
  signalFxIngester,
  multiplexMetricStreams,
} from '../lib/metricstream';

const HOUR = 3600000;

suite('metricstream', () => {
  let fakes;
  let sink;
  let source;

  beforeEach(async () => {
    fakes = {};
    fakes.signalFxRest = new FakeSignalFxRest();
    fakes.clock = new FakeClock();

    sink = new MetricStreamSink(fakes.clock);

    source = new MetricStreamSource(fakes.clock);
  });

  suite('signalFxMetricStream', () => {
    test('rejects invalid resolutions', () => {
      try {
        signalFxMetricStream({
          query: 'sf_metric:foo',
          resolution: 300000,
          start: fakes.clock.msec(),
          clock: fakes.clock,
          signalFxRest: fakes.signalFxRest,
        });
      } catch (err) {
        assume(err).matches(/invalid resolution/);
        return;
      }
      throw new Error('no exception');
    });

    test('returns historical data, then emits "live"', async () => {
      const start = fakes.clock.msec();
      await fakes.clock.tick(4 * HOUR);

      fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 0,   10);
      fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 0.5, 15);
      fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 1,   20);
      fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 1.5, 25);
      fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 2,   30);
      fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 2.5, 35);
      fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 3,   10);
      fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 3.5, 15);

      const stream = new signalFxMetricStream({
        query: 'sf_metric:foo',
        resolution: '1h',
        start: start,
        clock: fakes.clock,
        signalFxRest: fakes.signalFxRest,
      });
      let live = false;
      stream.on('live', () => live = true);
      stream.on('error', err => console.error(err, err.stack));

      stream.pipe(sink);

      // tick until it goes live
      while (!live) {
        await fakes.clock.tick(0);
      }

      assume(sink.received).to.deeply.equal([
        {received: 1014400000, chunk: {ts: start + HOUR * 0,   value: 10, live: false}},
        {received: 1014400000, chunk: {ts: start + HOUR * 0.5, value: 15, live: false}},
        {received: 1014400000, chunk: {ts: start + HOUR * 1,   value: 20, live: false}},
        {received: 1014400000, chunk: {ts: start + HOUR * 1.5, value: 25, live: false}},
        {received: 1014400000, chunk: {ts: start + HOUR * 2,   value: 30, live: false}},
        {received: 1014400000, chunk: {ts: start + HOUR * 2.5, value: 35, live: false}},
        {received: 1014400000, chunk: {ts: start + HOUR * 3,   value: 10, live: false}},
        {received: 1014400000, chunk: {ts: start + HOUR * 3.5, value: 15, live: false}},
      ]);
    });

    test('transitions from historical to live data', async () => {
      // advance clock to the next even multiple of an hour
      await fakes.clock.tick(HOUR - fakes.clock.msec() % HOUR);
      const start = fakes.clock.msec();

      fakes.clock.setTimeout('set datapoint at 0h',
        () => fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 0, 10),
        HOUR * 0 + 1000);
      fakes.clock.setTimeout('set datapoint at 1h',
        () => fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 1, 15),
        HOUR * 1 + 500);
      fakes.clock.setTimeout('set datapoint at 2h',
        () => fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 2, 20),
        HOUR * 2 + 450);
      fakes.clock.setTimeout('set datapoint at 3h',
        () => fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 3, 25),
        HOUR * 3 + 550);
      fakes.clock.setTimeout('set datapoint at 4h',
        () => fakes.signalFxRest.fakeDatapoint('sf_metric:foo', start + HOUR * 4, 30),
        HOUR * 4 + 550);

      await fakes.clock.tick(HOUR);

      const stream = new signalFxMetricStream({
        query: 'sf_metric:foo',
        resolution: '1h',
        start: start,
        clock: fakes.clock,
        signalFxRest: fakes.signalFxRest,
      });
      let live = false;
      stream.on('live', () => live = true);
      stream.on('error', err => console.error(err, err.stack));

      stream.pipe(sink);

      // tick ahead, adding new datapoints as they arrive
      await fakes.clock.tick(HOUR * 5);

      const expected = [
        {received: start + HOUR * 1,
          chunk: {ts: start + HOUR * 0, value: 10, live: false}},
        {received: start + HOUR * 2 + 15000, // 15000ms is QUANTIZER_DELAY
          chunk: {ts: start + HOUR * 1, value: 15, live: true}},
        {received: start + HOUR * 2 + 15000,
          chunk: {ts: start + HOUR * 2, value: 20, live: true}},
        {received: start + HOUR * 3 + 15000,
          chunk: {ts: start + HOUR * 3, value: 25, live: true}},
        {received: start + HOUR * 4 + 15000,
          chunk: {ts: start + HOUR * 4, value: 30, live: true}},
      ];

      assume(sink.received).to.deeply.equal(expected);
    });
  });

  suite('metricLoggerStream', () => {
    test('logs datapoints and passes them through', async () => {
      const logged = [];
      source.sendAt(1000000500, {ts: 1000000000, value: 1, live: false});
      source.sendAt(1000300400, {ts: 1000300000, value: 2, live: false});
      source.sendAt(1000600450, {ts: 1000600000, value: 3, live: true});
      source
        .pipe(metricLoggerStream({prefix: 'pfx', log: (x) => logged.push(x), clock: fakes.clock}))
        .pipe(sink);

      await fakes.clock.tick(300000 * 4);

      assume(logged).to.deeply.equal([
        'pfx: ts=1000000000: 1 (historical)',
        'pfx: ts=1000300000: 2 (historical)',
        'pfx: ts=1000600000: 3 (live, 0.45s delay)',
      ]);

      assume(sink.received).to.deeply.equal([
        {received: 1000000500, chunk: {ts: 1000000000, value: 1, live: false}},
        {received: 1000300400, chunk: {ts: 1000300000, value: 2, live: false}},
        {received: 1000600450, chunk: {ts: 1000600000, value: 3, live: true}},
      ]);
    });
  });

  suite('signalFxIngester', () => {
    test('throws an error on invalid types', () => {
      try {
        signalFxIngester({metric: 'foo.bar', type: 'knob', ingest: fakes.ingest});
      } catch (err) {
        assume(err).to.match(/Unknown metric type/);
        return;
      }
      throw new Error('did not throw');
    });

    test('ingests datapoints and passes them through', async () => {
      const logged = [];
      source.sendAt(1000000500, {ts: 1000000000, value: 1, live: false});
      source.sendAt(1000300400, {ts: 1000300000, value: 2, live: false});
      source.sendAt(1000600450, {ts: 1000600000, value: 3, live: true});
      source
        .pipe(metricLoggerStream({clock: fakes.clock, log: debugModule('output')}))
        .pipe(signalFxIngester({metric: 'foo.errors', type: 'gauge', ingest: fakes.ingest}))
        .pipe(sink);

      await fakes.clock.tick(300000 * 4);

      assume(fakes.ingest.ingested).to.deeply.equal([
        {gauges: [{metric: 'foo.errors', timestamp: 1000000000, value: 1}]},
        {gauges: [{metric: 'foo.errors', timestamp: 1000300000, value: 2}]},
        {gauges: [{metric: 'foo.errors', timestamp: 1000600000, value: 3}]},
      ]);

      assume(sink.received).to.deeply.equal([
        {received: 1000000500, chunk: {ts: 1000000000, value: 1, live: false}},
        {received: 1000300400, chunk: {ts: 1000300000, value: 2, live: false}},
        {received: 1000600450, chunk: {ts: 1000600000, value: 3, live: true}},
      ]);
    });
  });

  suite('multiplexMetricStreams', () => {
    let sources;
    const setupSource = (src, sends) => {
      sends.forEach(({at, ts, value, live}) => {
        sources[src].stream.sendAt(at, {ts, value, live});
      });
    };

    beforeEach(() => {
      sources = [
        {stream: new MetricStreamSource(fakes.clock), name: 'stream0'},
        {stream: new MetricStreamSource(fakes.clock), name: 'stream1'},
        {stream: new MetricStreamSource(fakes.clock), name: 'stream2'},
      ];
    });

    test('multiplexes historical data, with missing values carried through from the last occurrence', async () => {
      setupSource(0, [
        {at: 1000180000, ts: 1000000000, value: 1, live: false},
        {at: 1000180000, ts: 1000060000, value: 2, live: false},
        {at: 1000180000, ts: 1000120000, value: 3, live: false},
        {at: 1000180000, ts: 1000180000, value: 4, live: true},
      ]);
      setupSource(1, [
        {at: 1000180000, ts: 1000060000, value: 22, live: false},
        {at: 1000180000, ts: 1000180000, value: 24, live: true},
      ]);

      setupSource(2, [
        {at: 1000180000, ts: 1000060000, value: 32, live: false},
        {at: 1000180000, ts: 1000120000, value: 33, live: false},
        {at: 1000180000, ts: 1000180000, value: 34, live: true},
      ]);

      multiplexMetricStreams({streams: sources, clock: fakes.clock})
        .pipe(metricLoggerStream({clock: fakes.clock, log: debugModule('output')}))
        .pipe(sink);

      await fakes.clock.tick(190000);

      assume(sink.received).to.deeply.equal([
        {received: 1000180000, chunk: {ts: 1000000000, value: [1, undefined, undefined], live: false}},
        {received: 1000180000, chunk: {ts: 1000060000, value: [2, 22, 32], live: false}},
        {received: 1000180000, chunk: {ts: 1000120000, value: [3, 22, 33], live: false}},
        // note 500ms delay is applied to this live datapoint:
        {received: 1000180500, chunk: {ts: 1000180000, value: [4, 24, 34], live: true}},
      ]);
    });

    test('delays live data consistently', async () => {
      setupSource(0, [ // 500ms delay
        {at: 1000600500, ts: 1000600000, value: 11, live: true},
        {at: 1001200500, ts: 1001200000, value: 12, live: true},
        {at: 1001800500, ts: 1001800000, value: 13, live: true},
        {at: 1002400500, ts: 1002400000, value: 14, live: true},
      ]);
      setupSource(1, [ // 1500ms delay
        {at: 1000601500, ts: 1000600000, value: 21, live: true},
        {at: 1001201500, ts: 1001200000, value: 22, live: true},
        {at: 1001801500, ts: 1001800000, value: 23, live: true},
        {at: 1002401500, ts: 1002400000, value: 24, live: true},
      ]);
      setupSource(2, [ // 2000ms delay
        {at: 1000602000, ts: 1000600000, value: 31, live: true},
        {at: 1001202000, ts: 1001200000, value: 32, live: true},
        {at: 1001802000, ts: 1001800000, value: 33, live: true},
        {at: 1002402000, ts: 1002400000, value: 34, live: true},
      ]);

      multiplexMetricStreams({streams: sources, clock: fakes.clock})
        .pipe(metricLoggerStream({clock: fakes.clock, log: debugModule('output')}))
        .pipe(sink);

      await fakes.clock.tick(3000000);

      // applied delay is 2750 ms: 2000ms (max input delay) + 250ms (12.5%) + 500ms
      assume(sink.received).to.deeply.equal([
        {received: 1000602750, chunk: {ts: 1000600000, value: [11, 21, 31], live: true}},
        {received: 1001202750, chunk: {ts: 1001200000, value: [12, 22, 32], live: true}},
        {received: 1001802750, chunk: {ts: 1001800000, value: [13, 23, 33], live: true}},
        {received: 1002402750, chunk: {ts: 1002400000, value: [14, 24, 34], live: true}},
      ]);
    });

    test('starts when a stream goes live but never produces data', async () => {
      // source 0 never produces data, but does eventually go "live", meaning if it ever does
      // produce data it will be live
      fakes.clock.setTimeout('stream 0 goes live', () => {
        sources[0].stream.live = true;
        sources[0].stream.emit('live');
      }, 1000602200 - fakes.clock.msec());

      setupSource(1, [ // 1500ms delay
        {at: 1000601500, ts: 1000600000, value: 21, live: true},
        {at: 1001201500, ts: 1001200000, value: 22, live: true},
        {at: 1001801500, ts: 1001800000, value: 23, live: true},
        {at: 1002401500, ts: 1002400000, value: 24, live: true},
      ]);
      setupSource(2, [
        {at: 1000600500, ts: 1000600000, value: 31, live: true},
        {at: 1001200500, ts: 1001200000, value: 32, live: true},
        {at: 1001800500, ts: 1001800000, value: 33, live: true},
        {at: 1002400500, ts: 1002400000, value: 34, live: true},
      ]);

      multiplexMetricStreams({streams: sources, clock: fakes.clock})
        .pipe(metricLoggerStream({clock: fakes.clock, log: debugModule('output')}))
        .pipe(sink);

      await fakes.clock.tick(3000000);

      assume(sink.received).to.deeply.equal([
        // for the first tick, the multiplexer is still thinking things aren't live..
        {received: 1000602200, chunk: {ts: 1000600000, value: [undefined, 21, 31], live: false}},
        {received: 1001202187, chunk: {ts: 1001200000, value: [undefined, 22, 32], live: true}},
        {received: 1001802187, chunk: {ts: 1001800000, value: [undefined, 23, 33], live: true}},
        {received: 1002402187, chunk: {ts: 1002400000, value: [undefined, 24, 34], live: true}},
      ]);
    });

    test('skips missing datapoints', async () => {
      setupSource(0, [
        {at: 1000600500, ts: 1000600000, value: 11, live: true},
        {at: 1002400500, ts: 1002400000, value: 14, live: true},
      ]);
      setupSource(1, [
        {at: 1001801500, ts: 1001800000, value: 23, live: true},
        {at: 1002401500, ts: 1002400000, value: 24, live: true},
      ]);
      setupSource(2, [
        {at: 1000602000, ts: 1000600000, value: 31, live: true},
        {at: 1001802000, ts: 1001800000, value: 33, live: true},
      ]);

      multiplexMetricStreams({streams: sources, clock: fakes.clock})
        .pipe(metricLoggerStream({clock: fakes.clock, log: debugModule('output')}))
        .pipe(sink);

      await fakes.clock.tick(3000000);

      assume(sink.received).to.deeply.equal([
        // note there are no datapoints at 120 seconds, so no output; furthermore, the stream
        // is not live until 1001801500 when source 0 finally goes live
        {received: 1001801500, chunk: {ts: 1000600000, value: [11, undefined, 31], live: false}},
        {received: 1001802750, chunk: {ts: 1001800000, value: [11, 23, 33], live: true}},
        {received: 1002402750, chunk: {ts: 1002400000, value: [14, 24, 33], live: true}},
      ]);
    });
  });
});

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

suite('eb', function () {
  const assume = require('assume');
  const helper = require('./helper');
  let fakes, collector, basetime;

  const dh = (day, hour) => basetime + day * DAY + hour * HOUR;
  const makeSlo = fn => {
    // fill in the last three days' data
    for (let d = -3; d < 0; d++) {
      for (let h = 0; h < 24; h++) {
        fakes.signalFxRest.fakeDatapoint('sf_metric:slo.eb-test', dh(d, h), fn(d, h));
      }
    }
  };

  const roundIngestValues = ingested => {
    // round the ingested values to two digits to avoid float
    // comparison issues
    ingested.forEach(call => {
      call.gauges.forEach(gauge => {
        gauge.value = Math.round(gauge.value * 100) / 100;
      });
    });
  };

  setup(async () => {
    fakes = await helper.makeCollector('eb.eb-test');
    collector = fakes.collector;

    // basetime is the next even hour
    basetime = fakes.clock.msec() + HOUR - fakes.clock.msec() % HOUR;
    fakes.clock.tick(basetime - fakes.clock.msec());
  });

  suite('calculate', () => {
    test('calculates error budget of 1 when SLO is always 1', async () => {
      makeSlo((d, h) => 1.0);
      await collector.calculate();
      assume(fakes.ingest.ingested).to.deeply.equal([
        {gauges: [{metric: 'eb.eb-test', timestamp: dh(0, 0), value: 1.0}]},
      ]);
    });

    test('calculates error budget of 0 when SLO is 0 for an hour', async () => {
      makeSlo((d, h) => d === -1 && h === 10 ? 0.0 : 1.0);
      await collector.calculate();
      assume(fakes.ingest.ingested).to.deeply.equal([
        {gauges: [{metric: 'eb.eb-test', timestamp: dh(0, 0), value: 0}]},
      ]);
    });

    test('calculates error budget of about 0.48 when SLO is 0 for a quarter-hour', async () => {
      // 0 for a quarter-hour means that hour averages to 0.75
      makeSlo((d, h) => d === -1 && h === 10 ? 0.75 : 1.0);
      await collector.calculate();
      roundIngestValues(fakes.ingest.ingested);
      assume(fakes.ingest.ingested).to.deeply.equal([
        {gauges: [{metric: 'eb.eb-test', timestamp: dh(0, 0), value: 0.48}]},
      ]);
    });
  });

  suite('run', () => {
    test('calculates datapoints for every hour', async () => {
      makeSlo((d, h) => 1.0);
      await fakes.clock.tick(HOUR * 5);
      assume(fakes.ingest.ingested).to.deeply.equal([
        {gauges: [{metric: 'eb.eb-test', timestamp: dh(0, 0), value: 1}]},
        // goes to 0 because missing data is treated as 0
        {gauges: [{metric: 'eb.eb-test', timestamp: dh(0, 1), value: 0}]},
        {gauges: [{metric: 'eb.eb-test', timestamp: dh(0, 2), value: 0}]},
        {gauges: [{metric: 'eb.eb-test', timestamp: dh(0, 3), value: 0}]},
        {gauges: [{metric: 'eb.eb-test', timestamp: dh(0, 4), value: 0}]},
      ]);
    });
  });
});

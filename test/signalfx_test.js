const assume = require('assume');
const load = require('../src/main');
const SignalFxRest = require('../src/signalfx-rest');

suite('SignalFxRest', function() {
  let rest;
  let apiTokenPresent = false;

  suiteSetup(async function() {
    const cfg = await load('cfg', {profile: 'test'});
    if (cfg.signalfx.apiToken) {
      apiTokenPresent = true;
      rest = new SignalFxRest(cfg.signalfx.apiToken);
    }
  });

  suite('timeserieswindow', async function() {
    setup(function() {
      if (!apiTokenPresent) {
        this.skip();
      }
    });

    test('throws an error for a nonexistent metric', async function() {
      let gotError;
      await rest.timeserieswindow({
        query: 'sf_metric:no.such.metric',
        startMs: new Date() - 1000 * 3600 * 24,
        endMs: new Date() - 1000 * 3600,
        resolution: 1000 * 3600,
      }).catch(err => gotError = err);
      assume(gotError).inherits(Error);
    });

    test('returns a list of (timestamp, value) pairs for a demo metric', async function() {
      let ts = await rest.timeserieswindow({
        query: 'sf_metric:demo.trans.count AND demo_host:server6 ' +
               'AND demo_customer:samslack.com AND demo_datacenter:Tokyo',
        startMs: new Date() - 1000 * 3600 * 24,
        endMs: new Date() - 1000 * 3600,
        resolution: 1000 * 3600,
      });
      assume(ts).is.an('array');
      assume(ts[0]).is.an('array');
      assume(ts[0][0]).is.a('number');
      assume(ts[0][1]).is.a('number');
    });
  });
});


import assume from 'assume';
import load from '../lib/main';

suite('Clock', () => {
  let clock;

  suiteSetup(async function() {
    clock = await load('clock', {profile: 'test'});
  });

  after(() => {
    // shut it all down!!!
    clock._stop = true;
  });

  suite('msec', () =>  {
    test('returns the current time', () => {
      assume(clock.msec() - new Date()).is.lessThan(1000);
    });
  });

  suite('setTimeout', () =>  {
    test('sets a timeout', async () => {
      let called = false;
      clock.setTimeout('set called', () => called = true, 50);
      assume(called).false();

      await new Promise(resolve => setTimeout(resolve, 100)); // sleep 100ms

      assume(called).true();
    });

    test('handles errors', async () => {
      clock.setTimeout('crash', () => { throw new Error('uhoh'); }, 5);

      await new Promise(resolve => setTimeout(resolve, 10)); // sleep 10ms
    });

    test('handles sync errors', async () => {
      clock.setTimeout('crash', () => { throw new Error('uhoh'); }, 5);

      await new Promise(resolve => setTimeout(resolve, 10)); // sleep 10ms
    });

    test('handles async errors', async () => {
      clock.setTimeout('crash', async () => { throw new Error('uhoh'); }, 5);

      await new Promise(resolve => setTimeout(resolve, 10)); // sleep 10ms
    });
  });

  suite('periodically', () =>  {
    test('runs a function periodically', async () => {
      let calls = 0;
      clock.periodically(10, 'inc', () => calls++);
      assume(calls).equals(0);
      await new Promise(resolve => setTimeout(resolve, 15)); // sleep 15ms
      assume(calls).equals(1);
      await new Promise(resolve => setTimeout(resolve, 10)); // sleep 10ms
      assume(calls).equals(2);
    });
  });
});

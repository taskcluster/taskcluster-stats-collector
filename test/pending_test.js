const assume = require('assume');
const helper = require('./helper');

suite('collector.pending', () => {
  let fakes;

  const fakeTaskChange = ({state, scheduled, started, taskId}) => {
    fakes.listener.emit('task-message', {
      action: `task-${state}`,
      payload: {
        status: {
          taskId: taskId || 'taskid',
          provisionerId: 'prov',
          workerType: 'wt',
          runs: [
            {
              scheduled: new Date(scheduled || fakes.clock.msec() - 1000),
              started: started ? new Date(started) : undefined,
            },
          ],
        },
        runId: 0,
      },
    });
  };

  const assertMeasures = (expected) => {
    assume(fakes.monitor.measures).to.deeply.equal(expected);
    fakes.monitor.measures = {};
  };

  setup(async () => {
    fakes = await helper.makeCollector('pending');
  });

  test('nothing happens without input', async () => {
    await fakes.clock.tick(600000);
    assertMeasures({});
  });

  test('at startup, unpaired task runs are measured, but that stops once a pair is seen', async () => {
    fakeTaskChange({state: 'running', taskId: 't1', scheduled: fakes.clock.msec() - 7000,
      started: fakes.clock.msec()});
    fakeTaskChange({state: 'pending', taskId: 't3', scheduled: fakes.clock.msec()});
    await fakes.clock.tick(10000);
    fakeTaskChange({state: 'running', taskId: 't2', scheduled: fakes.clock.msec() - 8000, 
      started: fakes.clock.msec()});
    await fakes.clock.tick(1000);
    fakeTaskChange({state: 'running', taskId: 't3', scheduled: fakes.clock.msec() - 11000, 
      started: fakes.clock.msec()});
    await fakes.clock.tick(1000);
    fakeTaskChange({state: 'running', taskId: 't4', scheduled: fakes.clock.msec() - 9000, 
      started: fakes.clock.msec()});
    await fakes.clock.tick(1000);
    assertMeasures({
      // note that t4 is not represented here
      'tc-stats-collector.tasks.prov.wt.pending': [7000, 8000],
    });
  });

  test('at startup, unpaired pending tasks are ignored', async () => {
    fakes.queue.setStatus('t1', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't1', scheduled: 1000});
    await fakes.clock.tick(1000);
    fakes.queue.setStatus('t2', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't2', scheduled: 2000});
    await fakes.clock.tick(600000);
    assertMeasures({});
  });

  test('after a pending/running pair, pending tasks are measured periodically', async () => {
    const scheduled = fakes.clock.msec();

    fakeTaskChange({state: 'pending', taskId: 'primer', scheduled});
    fakeTaskChange({state: 'running', taskId: 'primer', scheduled});

    fakes.queue.setStatus('t1', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't1', scheduled});
    await fakes.clock.tick(80000);
    assertMeasures({
      'tc-stats-collector.tasks.prov.wt.pending': [60000],
    }); // measured at the flush interval
  });

  test('the measure represents the longest-pending task', async () => {
    fakeTaskChange({state: 'pending', taskId: 'primer', scheduled: fakes.clock.msec()});
    fakeTaskChange({state: 'running', taskId: 'primer', scheduled: fakes.clock.msec()});

    fakes.queue.setStatus('t1', 'pending');
    const scheduledT1 = fakes.clock.msec();
    fakeTaskChange({state: 'pending', taskId: 't1', scheduled: scheduledT1});
    await fakes.clock.tick(10000);

    fakes.queue.setStatus('t2', 'pending');
    const scheduledT2 = fakes.clock.msec();
    fakeTaskChange({state: 'pending', taskId: 't2', scheduled: scheduledT2});
    await fakes.clock.tick(10000);

    fakes.queue.setStatus('t3', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't3', scheduled: fakes.clock.msec()});
    await fakes.clock.tick(10000);

    await fakes.clock.tick(30000);
    assertMeasures({
      'tc-stats-collector.tasks.prov.wt.pending': [fakes.clock.msec() - scheduledT1],
    });

    fakeTaskChange({state: 'running', taskId: 't1'});
    fakeTaskChange({state: 'running', taskId: 't3'});

    await fakes.clock.tick(60000);
    assertMeasures({
      'tc-stats-collector.tasks.prov.wt.pending': [fakes.clock.msec() - scheduledT2],
    });
  });

  test('long-pending tasks that are not actually pending are found out by check', async () => {
    fakeTaskChange({state: 'pending', taskId: 'primer', scheduled: fakes.clock.msec()});
    fakeTaskChange({state: 'running', taskId: 'primer', scheduled: fakes.clock.msec()});

    fakes.queue.setStatus('t1', 'pending');
    const scheduledT1 = fakes.clock.msec();
    fakeTaskChange({state: 'pending', taskId: 't1', scheduled: scheduledT1});
    await fakes.clock.tick(60000);
    assertMeasures({
      'tc-stats-collector.tasks.prov.wt.pending': [fakes.clock.msec() - scheduledT1],
    });

    fakes.queue.setStatus('t2', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't2'});

    fakes.queue.setStatus('t1', 'running');
    fakes.queue.setStatus('t2', 'running');

    // how long it takes to discover this is an implementation detail, so
    // ignore the intervening measures..
    await fakes.clock.tick(500000);
    fakes.monitor.measures = {};

    await fakes.clock.tick(60000);
    assertMeasures({
      'tc-stats-collector.tasks.prov.wt.pending': [0],
    });
  });
});

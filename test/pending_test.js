suite('collector.pending', () => {
  let assume = require('assume');
  let helper = require('./helper');
  let fakes;

  let fakeTaskChange = ({state, scheduled, taskId}) => {
    fakes.listener.emit('task-message', {
      action: `task-${state}`,
      payload: {
        status: {
          taskId: taskId || 'taskid',
          provisionerId: 'prov',
          workerType: 'wt',
          runs: [
            {scheduled: new Date(scheduled || fakes.clock.msec() - 1000)},
          ],
        },
        runId: 0,
      },
    });
  };

  let assertMeasures = (expected) => {
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

  test('at startup, unpaired task runs are ignored', async () => {
    fakeTaskChange({state: 'running', taskId: 't1'});
    fakeTaskChange({state: 'running', taskId: 't2'});
    await fakes.clock.tick(600000);
    assertMeasures({});
  });

  test('at startup, unpaired pending tasks are ignored', async () => {
    fakes.queue.setStatus('t1', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't1'});
    await fakes.clock.tick(1000);
    fakes.queue.setStatus('t2', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't2'});
    await fakes.clock.tick(600000);
    assertMeasures({});
  });

  test('after a pending/running pair, pending tasks are measured periodically', async () => {
    let scheduled = fakes.clock.msec();

    fakeTaskChange({state: 'pending', taskId: 'primer', scheduled});
    fakeTaskChange({state: 'running', taskId: 'primer', scheduled});

    fakes.queue.setStatus('t1', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't1', scheduled});
    await fakes.clock.tick(80000);
    assertMeasures({
      'tasks.wt.pending': [60000],
      'tasks.prov.wt.pending': [60000],
    }); // measured at the flush interval
  });

  test('the measure represents the longest-pending task', async () => {
    fakeTaskChange({state: 'pending', taskId: 'primer', scheduled: fakes.clock.msec()});
    fakeTaskChange({state: 'running', taskId: 'primer', scheduled: fakes.clock.msec()});

    fakes.queue.setStatus('t1', 'pending');
    let scheduledT1 = fakes.clock.msec();
    fakeTaskChange({state: 'pending', taskId: 't1', scheduled: scheduledT1});
    await fakes.clock.tick(10000);

    fakes.queue.setStatus('t2', 'pending');
    let scheduledT2 = fakes.clock.msec();
    fakeTaskChange({state: 'pending', taskId: 't2', scheduled: scheduledT2});
    await fakes.clock.tick(10000);

    fakes.queue.setStatus('t3', 'pending');
    fakeTaskChange({state: 'pending', taskId: 't3', scheduled: fakes.clock.msec()});
    await fakes.clock.tick(10000);

    await fakes.clock.tick(30000);
    assertMeasures({
      'tasks.wt.pending': [fakes.clock.msec() - scheduledT1],
      'tasks.prov.wt.pending': [fakes.clock.msec() - scheduledT1],
    });

    fakeTaskChange({state: 'running', taskId: 't1'});
    fakeTaskChange({state: 'running', taskId: 't3'});

    await fakes.clock.tick(60000);
    assertMeasures({
      'tasks.wt.pending': [fakes.clock.msec() - scheduledT2],
      'tasks.prov.wt.pending': [fakes.clock.msec() - scheduledT2],
    });
  });

  test('long-pending tasks that are not actually pending are found out by check', async () => {
    fakeTaskChange({state: 'pending', taskId: 'primer', scheduled: fakes.clock.msec()});
    fakeTaskChange({state: 'running', taskId: 'primer', scheduled: fakes.clock.msec()});

    fakes.queue.setStatus('t1', 'pending');
    let scheduledT1 = fakes.clock.msec();
    fakeTaskChange({state: 'pending', taskId: 't1', scheduled: scheduledT1});
    await fakes.clock.tick(60000);
    assertMeasures({
      'tasks.wt.pending': [fakes.clock.msec() - scheduledT1],
      'tasks.prov.wt.pending': [fakes.clock.msec() - scheduledT1],
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
      'tasks.wt.pending': [0],
      'tasks.prov.wt.pending': [0],
    });
  });
});

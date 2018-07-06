const assume = require('assume');
const helper = require('./helper');

suite('collector.running', () => {
  let fakes;

  const fakeTaskChange = ({state, runs}) => {
    fakes.listener.emit('task-message', {
      action: `task-${state}`,
      payload: {
        status: {
          workerType: 'wt',
          runs,
        },
      },
    });
  };

  const assertMeasures = (expected) => {
    assume(fakes.monitor.measures).to.deeply.equal(expected);
    fakes.monitor.measures = {};
  };

  const assertCounts = (expected) => {
    assume(fakes.monitor.counts).to.deeply.equal(expected);
    fakes.monitor.counts = {};
  };

  setup(async () => {
    fakes = await helper.makeCollector('running');
  });

  test('nothing happens for pending or running tasks', async () => {
    fakeTaskChange({state: 'pending', runs: []});
    fakeTaskChange({state: 'running', runs: []});
    assertMeasures({});
    assertCounts({});
  });

  test('a resolved task has its run analyzed', async () => {
    fakeTaskChange({state: 'resolved', runs: [
      {reasonCreated: 'scheduled', reasonResolved: 'completed', started: 10000, resolved: 20000},
    ]});
    assertMeasures({'tc-stats-collector.tasks.wt.running': [10000]});
    assertCounts({'tc-stats-collector.tasks.wt.resolved.completed': 1});
  });

  test('deadline-exceeded runs are not timed, but are counted', async () => {
    fakeTaskChange({state: 'resolved', runs: [
      {reasonCreated: 'scheduled', reasonResolved: 'deadline-exceeded', started: 10000, resolved: 20000},
    ]});
    assertMeasures({});
    assertCounts({'tc-stats-collector.tasks.wt.resolved.deadline-exceeded': 1});
  });

  test('a run created due to retry, and any runs before it, are ignored', async () => {
    fakeTaskChange({state: 'resolved', runs: [
      {reasonCreated: 'scheduled', reasonResolved: 'retry', started: 10000, resolved: 50000},
      {reasonCreated: 'retry', reasonResolved: 'failed', started: 50000, resolved: 80000},
      {reasonCreated: 'rerun', reasonResolved: 'completed', started: 80000, resolved: 90000},
    ]});
    assertMeasures({'tc-stats-collector.tasks.wt.running': [10000]});
    assertCounts({'tc-stats-collector.tasks.wt.resolved.completed': 1});
  });
});

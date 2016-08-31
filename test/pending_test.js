suite('pending', () => {
  let assume = require('assume');
  let {PendingCollector} = require('../lib/pending');

  let now = new Date(2016, 7, 1).getTime();
  let january = new Date(2016, 0, 1).getTime();
  let february = new Date(2016, 1, 1).getTime();
  let march = new Date(2016, 2, 1).getTime();

  let monitors;
  let fakemonitor = {measure: (name, value) => { monitors[name] = value; }};

  let statuses = {};
  let fakequeue = {
    status: (taskId) => {
      assume(statuses).to.include(taskId);
      return Promise.resolve(statuses[taskId]);
    },
  };

  let collector;

  before(() => {
    collector = new PendingCollector({monitor: fakemonitor, listener: undefined});
    collector.queue = fakequeue;
  });

  beforeEach(() => {
    monitors = {};
    statuses = {};
    collector.pendingTasks = {};
    collector.readyWorkerTypes = {};
  });

  suite('earliest', () => {
    test('returns null, now for an empty set of tasks', () => {
      collector.pendingTasks['wt'] = {};
      let {taskKey, scheduled} = collector.earliest('wt', now);
      assume(taskKey).equals(null);
      assume(scheduled).equals(now);
    });

    test('returns null, now for a missing set of tasks', () => {
      collector.pendingTasks['wt'] = {};
      let {taskKey, scheduled} = collector.earliest('wt', now);
      assume(taskKey).equals(null);
      assume(scheduled).equals(now);
    });

    test('returns oldest task given a few', () => {
      collector.pendingTasks = {
        wt: {
          mar: march,
          feb: february,
          jan: january,
        },
      };

      let {taskKey, scheduled} = collector.earliest('wt', now);
      assume(taskKey).equals('jan');
      assume(scheduled).equals(january);
    });
  });

  suite('update', () => {
    test('records an initial pending message correctly', () => {
      collector.update('wt', 'task1', true, january);
      assume(collector.pendingTasks).to.deeply.equal({wt: {task1: january}});
      assume(collector.readyWorkerTypes).to.deeply.equal({});
    });

    test('records nothing except the workerType for an initial non-pending', () => {
      collector.update('wt', 'task1', false, january);
      assume(collector.pendingTasks).to.deeply.equal({wt: {}});
      assume(collector.readyWorkerTypes).to.deeply.equal({});
    });

    test('records a ready worker type after seeing both pending and non-pending', () => {
      collector.update('wt', 'task1', true, january);
      collector.update('wt', 'task1', false, january);
      assume(collector.pendingTasks).to.deeply.equal({wt: {}});
      assume(collector.readyWorkerTypes).to.deeply.equal({wt: true});
    });
  });

  suite('flush', () => {
    test('does nothing for workerTypes not in readyWorkerTypes', () => {
      collector.pendingTasks = {wt: {task1: january}};
      collector.readyWorkerTypes = {};

      collector.flush(now);
      assume(monitors).to.deeply.equal({});
    });

    test('measures to the oldest time for each workerType', () => {
      collector.pendingTasks = {
        wt1: {
          task1: january,
          task2: march,
        },
        wt2: {
          task5: february,
        },
      };
      collector.readyWorkerTypes = {
        wt1: true,
        wt2: true,
      };
      collector.flush(now);
      assume(monitors).to.deeply.equal({
        'tasks.wt1.pending': now - january,
        'tasks.wt2.pending': now - february,
      });
    });
  });

  suite('check', () => {
    test('ignores workerTypes with no pending tasks', async () => {
      collector.pendingTasks = {wt: {}};
      await collector.check(now);
      assume(collector.pendingTasks).to.deeply.equal({wt: {}});
    });

    test('ignores workerTypes with recent pending tasks', async () => {
      collector.pendingTasks = {wt: {'task1/0': now - 200}};
      await collector.check(now);
      assume(collector.pendingTasks).to.deeply.equal({wt: {'task1/0': now - 200}});
    });

    test('does nothing for real pending tasks', async () => {
      collector.pendingTasks = {wt: {'task1/0': january}};
      statuses['task1'] = {status: {runs: [{state: 'pending'}]}};
      await collector.check(now);
      assume(collector.pendingTasks).to.deeply.equal({wt: {'task1/0': january}});
    });

    test('deletes (multiple) pending tasks that are not really pending', async () => {
      collector.pendingTasks = {
        wt: {
          'task1/0': january,
          'task2/0': january,
          'task2/1': january,
          'task3/0': january,
        },
      };
      statuses['task1'] = {status: {runs: [{state: 'completed'}]}};
      statuses['task2'] = {status: {runs: [{state: 'completed'}, {state: 'pending'}]}};
      statuses['task3'] = {status: {runs: [{state: 'pending'}]}};
      await collector.check(now);
      assume(collector.pendingTasks).to.deeply.equal({
        wt: {
          'task2/1': january,
          'task3/0': january,
        },
      });
    });
  });
});

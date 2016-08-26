suite('pending', () => {
  let assume = require('assume');
  let pending = require('../lib/pending');
  let now = new Date(2016, 7, 1).getTime();
  let january = new Date(2016, 0, 1).getTime();
  let february = new Date(2016, 1, 1).getTime();
  let march = new Date(2016, 2, 1).getTime();

  suite('earliest', () => {
    let earliest = pending.earliest;

    test('returns null, now for an empty list', () => {
      let {taskKey, scheduled} = earliest({pendingTasks: {wt: {}}}, 'wt', now);
      assume(taskKey).equals(null);
      assume(scheduled).equals(now);
    });

    test('returns oldest task given a few', () => {
      let state = {
        pendingTasks: {
          wt: {
            mar: march,
            feb: february,
            jan: january,
          },
        },
      };

      let {taskKey, scheduled} = earliest(state, 'wt', now);
      assume(taskKey).equals('jan');
      assume(scheduled).equals(january);
    });
  });

  suite('update', () => {
    let update = pending.update;

    test('records an initial pending message correctly', () => {
      let state = {pendingTasks: {}, readyWorkerTypes: {}};
      update(state, 'wt', 'task1', true, january);
      assume(state).to.deeply.equal({
        pendingTasks: {wt: {task1: january}},
        readyWorkerTypes: {},
      });
    });

    test('records nothing except the workerType for an initial non-pending', () => {
      let state = {pendingTasks: {}, readyWorkerTypes: {}};
      update(state, 'wt', 'task1', false, january);
      assume(state).to.deeply.equal({
        pendingTasks: {wt: {}},
        readyWorkerTypes: {},
      });
    });

    test('records a ready worker type after seeing both pending and non-pending', () => {
      let state = {pendingTasks: {}, readyWorkerTypes: {}};
      update(state, 'wt', 'task1', true, january);
      update(state, 'wt', 'task1', false, january);
      assume(state).to.deeply.equal({
        pendingTasks: {wt: {}},
        readyWorkerTypes: {wt: true},
      });
    });
  });

  suite('flush', () => {
    let flush = pending.flush;
    let monitors;
    let fakemonitor = {measure: (name, value) => { monitors[name] = value; }};

    beforeEach(() => {
      monitors = {};
    });

    test('does nothing for workerTypes not in readyWorkerTypes', () => {
      let state = {pendingTasks: {wt: {task1: 1234}}, readyWorkerTypes: {}};
      flush(state, fakemonitor, now);
      assume(monitors).to.deeply.equal({});
    });

    test('measures to the oldest time for each workerType', () => {
      let state = {
        pendingTasks: {
          wt1: {
            task1: january,
            task2: march,
          },
          wt2: {
            task5: february,
          },
        },
        readyWorkerTypes: {
          wt1: true,
          wt2: true,
        }};
      flush(state, fakemonitor, now);
      assume(monitors).to.deeply.equal({
        'tasks.wt1.pending': now - january,
        'tasks.wt2.pending': now - february,
      });
    });
  });
});

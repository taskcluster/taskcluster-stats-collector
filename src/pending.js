var _ = require('lodash');
var debug = require('debug')('stats-collector:pending');
var taskcluster = require('taskcluster-client');

const FLUSH_PERIOD = 30; // seconds

// check for pending tasks that aren't really pending with this frequency; should
// be smaller than MIN_CHECK_AGE
const CHECK_INTERVAL = 120; // seconds

// only check tasks pending at least this long; this should be lower than any alert
// thresholds for pending tasks.
const MIN_CHECK_AGE = 300; // seconds

// calculate the taskKey and scheduled date with the earliest scheduled time for
// the given workerType; if there are none, returns null and the current time
var earliest = (state, workerType, now) => {
  return _.reduce(state.pendingTasks[workerType], (res, scheduled, taskKey) => {
    if (scheduled < res.scheduled) {
      return {scheduled, taskKey};
    } else {
      return res;
    }
  }, {taskKey: null, scheduled: now});
};

// update the state based on a task message
var update = (state, workerType, taskKey, isPending, scheduled) => {
  let workerTypeState = state.pendingTasks[workerType];

  if (!workerTypeState) {
    state.pendingTasks[workerType] = workerTypeState = {};
  }

  if (isPending) {
    debug('task pending: %s at %s (%s)', taskKey, scheduled, workerType);
    workerTypeState[taskKey] = new Date(scheduled).getTime();
  } else {
    debug('task no longer pending: %s (%s)', taskKey, workerType);
    if (workerTypeState[taskKey]) {
      state.readyWorkerTypes[workerType] = true;
      delete workerTypeState[taskKey];
    }
  }
};

// update monitors based on the current state
var flush = (state, monitor, now) => {
  for (let workerType of Object.keys(state.readyWorkerTypes)) {
    let {taskKey, scheduled} = earliest(state, workerType, now);
    let waiting = taskKey ? now - scheduled : 0;
    monitor.measure(`tasks.${workerType}.pending`, waiting);
  }
};

// For each worker type with a task we think is pending for over MIN_CHECK_AGE,
// poll the status of that task and, if it is actually not pending, remove it
// from the list.  This provides a way to catch cases where the service misses
// a pulse message or they are delivered out of order.
var check = (state, queue, now) => {
  return Promise.all(Object.keys(state.pendingTasks).map(async (workerType) => {
    let {taskKey, scheduled} = earliest(state, workerType, now);
    if (taskKey && now - scheduled > MIN_CHECK_AGE * 1000) {
      let [taskId, runId] = taskKey.split('/');
      let taskStatus = await queue.status(taskId);
      if (taskStatus.status.runs[runId].state !== 'pending') {
        debug('task not actually pending: %s (%s)', taskKey, workerType);
        delete state.pendingTasks[workerType][taskKey];
      }
    }
  }));
};

module.exports = ({monitor, listener, credentials}) => {
  let state = {
    // mappings from task key to pending time, keyed by workerType; an empty list
    // here is significant in that it means there is nothing pending for that
    // workerType
    pendingTasks: {},

    // workerTypes for which we have seen a single task both enter and exit the
    // pending state, and thus have a reasonable expectation of knowing the
    // total pending time for, even if the stats-collector process has just
    // started.
    readyWorkerTypes: {},
  };

  listener.on('task-message', ({action, payload}) => {
    try {
      let taskKey = `${payload.status.taskId}/${payload.runId}`;
      let workerType = payload.status.workerType;
      let isPending = action === 'task-pending';
      let scheduled = payload.status.runs[payload.runId].scheduled;

      update(state, workerType, taskKey, isPending, scheduled);
    } catch (err) {
      debug('Failed to process message %s with error: %s, as JSON: %j',
            action, err, err, err.stack);
    }
  });

  setInterval(() => {
    try {
      flush(state, monitor, new Date().getTime());
    } catch (err) {
      debug('Failed to flush with error: %s, as JSON: %j',
            err, err, err.stack);
    }
  }, FLUSH_PERIOD * 1000);

  let queue = new taskcluster.Queue({credentials});
  let doCheck = () => {
    check(state, queue, new Date().getTime()).catch((err) => {
      console.log('While checking old tasks: %s', err);
    }).then(() => {
      // use a timeout instead of setInterval in case checks take too long; the
      // next round will only start after the last round finishes.
      setTimeout(doCheck, CHECK_INTERVAL * 1000);
    });
  };
  doCheck();
};

// for testing
module.exports.earliest = earliest;
module.exports.update = update;
module.exports.flush = flush;
module.exports.check = check;

var _ = require('lodash');
var debug = require('debug')('stats-collector:pending');

const FLUSH_PERIOD = 3; // seconds
const CHECK_PERIOD = 30; // seconds

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

module.exports = ({monitor, listener}) => {
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
};

// for testing
module.exports.earliest = earliest;
module.exports.update = update;
module.exports.flush = flush;

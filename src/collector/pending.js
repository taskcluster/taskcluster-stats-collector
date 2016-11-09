import collectorManager from '../collectormanager';
import taskcluster from 'taskcluster-client';
import _ from 'lodash';

const FLUSH_INTERVAL = 60; // seconds

// check for pending tasks that aren't really pending with this frequency; should
// be smaller than MIN_CHECK_AGE
const CHECK_INTERVAL = 120; // seconds

// only check tasks pending at least this long; this should be lower than any alert
// thresholds for pending tasks.
const MIN_CHECK_AGE = 300; // seconds

collectorManager.collector({
  name: 'pending',
  requires: ['monitor', 'listener', 'queue', 'clock'],
  // support emitting via statsum or directly as a time series
}, ({monitor, listener, queue, debug, clock}) => {

  // mappings from task key to pending time, keyed by workerType; an empty list
  // here is significant in that it means there is nothing pending for that
  // workerType
  const pendingTasks = {};

  // workerTypes for which we have seen a single task both enter and exit the
  // pending state, and thus have a reasonable expectation of knowing the
  // total pending time for, even if the stats-collector process has just
  // started.
  const readyWorkerTypes = {};

  // update the state based on a task message
  const update = (workerType, taskKey, isPending, scheduled) => {
    let workerTypeState = pendingTasks[workerType];

    if (!workerTypeState) {
      pendingTasks[workerType] = workerTypeState = {};
    }

    if (isPending) {
      debug('task pending: %s at %s (%s)', taskKey, scheduled, workerType);
      workerTypeState[taskKey] = new Date(scheduled).getTime();
    } else {
      debug('task no longer pending: %s (%s)', taskKey, workerType);
      if (workerTypeState[taskKey]) {
        // having seen this task through its entire pending cycle, let's
        // assume that we are now reporting accurate pending stats for this
        // workerType (this isn't entirely valid, but close enough)
        readyWorkerTypes[workerType] = true;
        delete workerTypeState[taskKey];
      }
    }
  };

  // calculate the taskKey and scheduled date with the earliest scheduled time for
  // the given workerType; if there are none, returns null and the current time
  const earliest = (workerType, now) => {
    return _.reduce(pendingTasks[workerType], (res, scheduled, taskKey) => {
      if (scheduled < res.scheduled) {
        return {scheduled, taskKey};
      } else {
        return res;
      }
    }, {taskKey: null, scheduled: now});
  };

  // update monitors based on the current state
  const flush = (now) => {
    for (let workerType of Object.keys(readyWorkerTypes)) {
      let {taskKey, scheduled} = earliest(workerType, now);
      let waiting = taskKey ? now - scheduled : 0;
      monitor.measure(`tasks.${workerType}.pending`, waiting);
    }
  };

  // For each worker type with a task we think is pending for over MIN_CHECK_AGE,
  // poll the status of that task and, if it is actually not pending, remove it
  // from the list.  This provides a way to catch cases where the service misses
  // a pulse message or they are delivered out of order.
  const check = (now) => {
    return Promise.all(Object.keys(pendingTasks).map(async (workerType) => {
      // repeatedly find the longest-pending task and verify it against the
      // queue, until we find one that actually is pending.
      while (1) {
        let {taskKey, scheduled} = earliest(workerType, now);
        if (taskKey && now - scheduled > MIN_CHECK_AGE * 1000) {
          let [taskId, runId] = taskKey.split('/');
          let taskStatus = await queue.status(taskId);
          if (taskStatus.status.runs[runId].state !== 'pending') {
            debug('task not actually pending: %s (%s)', taskKey, workerType);
            delete pendingTasks[workerType][taskKey];
            continue; // look at the next-earliest task
          }
        }
        break;
      }
    }));
  };

  listener.on('task-message', ({action, payload}) => {
    try {
      let taskKey = `${payload.status.taskId}/${payload.runId}`;
      let workerType = payload.status.workerType;
      let isPending = action === 'task-pending';
      let scheduled = payload.status.runs[payload.runId].scheduled;

      update(workerType, taskKey, isPending, scheduled);
    } catch (err) {
      debug('Failed to process message %s with error: %s, as JSON: %j',
            action, err, err, err.stack);
    }
  });

  // set up periodic flushes
  clock.periodically(FLUSH_INTERVAL * 1000, 'flush', () => {
    return flush(clock.msec());
  });

  // set up periodic checks of the oldest task
  clock.periodically(CHECK_INTERVAL * 1000, 'check', () => {
    return check(clock.msec());
  });
});

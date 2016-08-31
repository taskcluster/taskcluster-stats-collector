var _ = require('lodash');
var debug = require('debug')('stats-collector:pending');
var taskcluster = require('taskcluster-client');

const FLUSH_INTERVAL = 60; // seconds

// check for pending tasks that aren't really pending with this frequency; should
// be smaller than MIN_CHECK_AGE
const CHECK_INTERVAL = 120; // seconds

// only check tasks pending at least this long; this should be lower than any alert
// thresholds for pending tasks.
const MIN_CHECK_AGE = 300; // seconds

class PendingCollector {
  // Monitor the longest-pending task for each workerType

  constructor ({monitor, listener}) {
    // mappings from task key to pending time, keyed by workerType; an empty list
    // here is significant in that it means there is nothing pending for that
    // workerType
    this.pendingTasks = {};

    // workerTypes for which we have seen a single task both enter and exit the
    // pending state, and thus have a reasonable expectation of knowing the
    // total pending time for, even if the stats-collector process has just
    // started.
    this.readyWorkerTypes = {};

    this.queue = new taskcluster.Queue();
    this.listener = listener;
    this.monitor = monitor;
  };

  start () {
    this.listener.on('task-message', ({action, payload}) => {
      try {
        let taskKey = `${payload.status.taskId}/${payload.runId}`;
        let workerType = payload.status.workerType;
        let isPending = action === 'task-pending';
        let scheduled = payload.status.runs[payload.runId].scheduled;

        this.update(workerType, taskKey, isPending, scheduled);
      } catch (err) {
        debug('Failed to process message %s with error: %s, as JSON: %j',
              action, err, err, err.stack);
      }
    });

    // set up periodic flushes
    this.periodically(FLUSH_INTERVAL * 1000, 'flush', () => {
      return this.flush(new Date().getTime());
    });

    // set up periodic checks of the oldest task
    this.periodically(CHECK_INTERVAL * 1000, 'check', () => {
      return this.check(new Date().getTime());
    });
  };

  // Run fn periodically, whether async or not, surviving errors
  periodically (interval, name, fn) {
    let iterator = () => {
      debug('Running ' + name);
      Promise.resolve(fn()).catch((err) => {
        console.log('Failed while %s: %s', name, err);
      }).then(() => {
        setTimeout(iterator, interval);
      });
    };
    setTimeout(iterator, interval);
  };

  // update the state based on a task message
  update (workerType, taskKey, isPending, scheduled) {
    let workerTypeState = this.pendingTasks[workerType];

    if (!workerTypeState) {
      this.pendingTasks[workerType] = workerTypeState = {};
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
        this.readyWorkerTypes[workerType] = true;
        delete workerTypeState[taskKey];
      }
    }
  };

  // calculate the taskKey and scheduled date with the earliest scheduled time for
  // the given workerType; if there are none, returns null and the current time
  earliest (workerType, now) {
    return _.reduce(this.pendingTasks[workerType], (res, scheduled, taskKey) => {
      if (scheduled < res.scheduled) {
        return {scheduled, taskKey};
      } else {
        return res;
      }
    }, {taskKey: null, scheduled: now});
  };

  // update monitors based on the current state
  flush (now) {
    for (let workerType of Object.keys(this.readyWorkerTypes)) {
      let {taskKey, scheduled} = this.earliest(workerType, now);
      let waiting = taskKey ? now - scheduled : 0;
      this.monitor.measure(`tasks.${workerType}.pending`, waiting);
    }
  };

  // For each worker type with a task we think is pending for over MIN_CHECK_AGE,
  // poll the status of that task and, if it is actually not pending, remove it
  // from the list.  This provides a way to catch cases where the service misses
  // a pulse message or they are delivered out of order.
  check (now) {
    return Promise.all(Object.keys(this.pendingTasks).map(async (workerType) => {
      let {taskKey, scheduled} = this.earliest(workerType, now);
      if (taskKey && now - scheduled > MIN_CHECK_AGE * 1000) {
        let [taskId, runId] = taskKey.split('/');
        let taskStatus = await this.queue.status(taskId);
        if (taskStatus.status.runs[runId].state !== 'pending') {
          debug('task not actually pending: %s (%s)', taskKey, workerType);
          delete this.pendingTasks[workerType][taskKey];
        }
      }
    }));
  };

};

module.exports = ({monitor, listener}) => {
  let collector = new PendingCollector({monitor, listener});
  collector.start();
};

// for testing
module.exports.PendingCollector = PendingCollector;

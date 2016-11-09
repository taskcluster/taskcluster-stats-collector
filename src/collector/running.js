import collectorManager from '../collectormanager';
import _ from 'lodash';

collectorManager.collector({
  name: 'running',
  requires: ['monitor', 'listener'],
  // support emitting via statsum or directly as a time series
}, ({monitor, listener, debug}) => {
  listener.on('task-message', ({action, payload}) => {
    try {
      if (action === 'task-pending' || action === 'task-running') {
        return;
      }

      var runs = payload.status.runs;
      var lastNonRetry = _.findLastIndex(runs, run => {
        return run.reasonCreated !== 'retry';
      });
      if (lastNonRetry === -1) {
        lastNonRetry = 0;
      }
      let workerType = payload.status.workerType;
      runs.slice(lastNonRetry).forEach(run => {
        if (run.reasonResolved !== 'deadline-exceeded') {
          var started = new Date(run.started);
          var resolved = new Date(run.resolved);
          monitor.measure(`tasks.${workerType}.running`, resolved - started);
        }
        monitor.count(`tasks.${workerType}.resolved.${run.reasonResolved}`);
      });
    } catch (err) {
      debug('Failed to process message %s with error: %s, as JSON: %j',
            action, err, err, err.stack);
    }
  });
});

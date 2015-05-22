var base = require('taskcluster-base');

//Records the amount of time the task spends in the pending state, in seconds
exports.pendingDuration = new base.stats.Series({
  name:       'pendingDuration',
  columns: {
    provisionerId:      base.stats.types.String,
    workerType:         base.stats.types.String,
    time:               base.stats.types.Number,
    duration:           base.stats.types.Number,
  },
});

//Records the amount of time the task spends in the running state, in seconds
exports.runningDuration = new base.stats.Series({
  name:       'runningDuration',
  columns: {
    provisionerId:      base.stats.types.String,
    workerType:         base.stats.types.String,
    time:               base.stats.types.Number,
    duration:           base.stats.types.Number,
  },
});

//Records the resoulution state of the task
exports.reasonResolved = new base.stats.Series({
  name:       'reasonResolved',
  columns: {
    provisionerId:      base.stats.types.String,
    workerType:         base.stats.types.String,
    time:               base.stats.types.Number,
    count:              base.stats.types.Number,
    reasonResolved:     base.stats.types.String,
  },
});

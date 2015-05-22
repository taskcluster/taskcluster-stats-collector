var base = require('taskcluster-base');

exports.pendingDuration = new base.stats.Series({
  name:       'pendingDuration',
  columns: {
    provisionerId:      base.stats.types.String,
    workerType:         base.stats.types.String,
    time:               base.stats.types.Number,
    duration:           base.stats.types.Number,
  },
});

exports.runningDuration = new base.stats.Series({
  name:       'runningDuration',
  columns: {
    provisionerId:      base.stats.types.String,
    workerType:         base.stats.types.String,
    time:               base.stats.types.Number,
    duration:           base.stats.types.Number,
  },
});

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

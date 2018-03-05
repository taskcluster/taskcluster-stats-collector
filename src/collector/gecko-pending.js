const {max, filter} = require('lodash');
const taskcluster = require('taskcluster-client');
const sli = require('../sli');
const slo = require('../slo');
const eb = require('../eb');

const MINUTE = 60 * 1000;

const getAwsWorkerTypes = async () => {
  const prov = new taskcluster.AwsProvisioner();
  return await prov.listWorkerTypes();
};

sli.declare({
  name: 'gecko.pending.test',
  description: [
    'The maximum pending time of any of the gecko test workerTypes.',
    '',
    'Each workerType is measured at the 95th percentile over a 5-minute',
    'period to avoid outliers.',
  ].join('\n'),
  inputs: async () => {
    const workerTypes = filter(await getAwsWorkerTypes(), workerType =>
        // old workerTypes are 'desktop-test*', but we still monitor those
        workerType.startsWith('desktop-test') || (
          // exclude *-alpha, *-beta as those are just for testing and may be delayed
          workerType.startsWith('gecko-t-') && !/-(alpha|beta)$/.test(workerType)));
    return workerTypes.map(wt => {
      return {
        spec: 'statsum',
        metric: `tc-stats-collector.tasks.aws-provisioner-v1.${wt}.pending`,
        resolution: '5m',
        percentile: 95,
      };
    });
  },
  aggregate: max,
});

sli.declare({
  name: 'gecko.pending.build',
  description: [
    'The maximum pending time of any of the gecko build workerTypes.',
    '',
    'Each workerType is measured at the 95th percentile over a 5-minute',
    'period to avoid outliers.',
  ].join('\n'),
  inputs: async () => {
    const workerTypes = filter(await getAwsWorkerTypes(),
        workerType => /^gecko-[123]-b-/.test(workerType));
    return workerTypes.map(wt => {
      return {
        spec: 'statsum',
        metric: `tc-stats-collector.tasks.aws-provisioner-v1.${wt}.pending`,
        resolution: '5m',
        percentile: 95,
      };
    });
  },
  aggregate: max,
});

sli.declare({
  name: 'gecko.pending.other',
  description: [
    'The maximum pending time of any of the non-test, non-build gecko workerTypes.',
    'This includes the decision task and image building.',
    '',
    'Each workerType is measured at the 95th percentile over a 5-minute',
    'period to avoid outliers.',
  ].join('\n'),
  inputs: async () => {
    const workerTypes = filter(await getAwsWorkerTypes(), workerType =>
        workerType.startsWith('gecko-') && !/^gecko-(t|[123]-b)-/.test(workerType));
    workerTypes.push('taskcluster-images'); // bug 1320328
    return workerTypes.map(wt => {
      return {
        spec: 'statsum',
        metric: `tc-stats-collector.tasks.aws-provisioner-v1.${wt}.pending`,
        resolution: '5m',
        percentile: 95,
      };
    });
  },
  aggregate: max,
});

slo.declare({
  name: 'gecko.pending',
  description: [
    'The pending time for gecko jobs should be within a reasonable limit.',
    'specifically, test and build jobs should start within 45 and 30 minutes of',
    'being scheduled respectively, while other jobs should start within 20 minutes.',
  ].join('\n'),
  indicators: [
    {sli: 'gecko.pending.other', resolution: '5m', met: v => v < 20 * MINUTE},
    {sli: 'gecko.pending.test', resolution: '5m', met: v => v < 45 * MINUTE},
    {sli: 'gecko.pending.build', resolution: '5m', met: v => v < 30 * MINUTE},
  ],
});

eb.declare({
  name: 'gecko.pending',
  description: [
    'Gecko pending times should be within their thresholds 99.5% of the time,',
    'measured over the previous two weeks.',
  ].join('\n'),
  nines: 95,
  days: 14,
});

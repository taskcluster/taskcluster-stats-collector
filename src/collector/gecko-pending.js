import {max} from 'lodash';
import sli from '../sli';
import slo from '../slo';
import eb from '../eb';

const MINUTE = 60 * 1000;

sli.declare({
  name: 'gecko.pending.test',
  description: [
    'The maximum pending time of any of the gecko test workerTypes.',
    '',
    'Each workerType is measured at the 95th percentile over a 5-minute',
    'period to avoid outliers.',
  ].join('\n'),
  // TODO: determine these dynamically from the AWS provisioner
  inputs: [
    'desktop-test',
    'desktop-test-large',
    'desktop-test-xlarge',
    'gecko-t-linux-medium',
    'gecko-t-linux-large',
    'gecko-t-linux-xlarge',
    'gecko-t-win10-64',
    'gecko-t-win10-64-gpu',
    'gecko-t-win7-32',
    'gecko-t-win7-32-gpu',
  ].map(wt => {
    return {
      spec: 'statsum',
      metric: `tc-stats-collector.tasks.aws-provisioner-v1.${wt}.pending`,
      resolution: '5m',
      percentile: 95,
    };
  }),
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
  // TODO: determine these dynamically from the AWS provisioner
  inputs: [
    'gecko-1-b-android',
    'gecko-1-b-linux',
    'gecko-1-b-macosx64',
    'gecko-1-b-win2012',
    'gecko-1-b-win2012-beta',
    'gecko-2-b-android',
    'gecko-2-b-linux',
    'gecko-2-b-macosx64',
    'gecko-2-b-win2012',
    'gecko-3-b-android',
    'gecko-3-b-linux',
    'gecko-3-b-macosx64',
    'gecko-3-b-win2012',
  ].map(wt => {
    return {
      spec: 'statsum',
      metric: `tc-stats-collector.tasks.aws-provisioner-v1.${wt}.pending`,
      resolution: '5m',
      percentile: 95,
    };
  }),
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
  // TODO: determine these dynamically from the AWS provisioner
  inputs: [
    'gecko-decision',
    'taskcluster-images',
  ].map(wt => {
    return {
      spec: 'statsum',
      metric: `tc-stats-collector.tasks.aws-provisioner-v1.${wt}.pending`,
      resolution: '5m',
      percentile: 95,
    };
  }),
  aggregate: max,
});

slo.declare({
  name: 'gecko.pending',
  description: [
    'The pending time for gecko jobs should be within a reasonable limit.',
    'specifically, test and build jobs should start within 30 minutes of',
    'being scheduled, while other jobs should start within 20 minutes.',
  ].join('\n'),
  indicators: [
    {sli: 'gecko.pending.other', resolution: '5m', met: v => v < 20 * MINUTE},
    {sli: 'gecko.pending.test', resolution: '5m', met: v => v < 30 * MINUTE},
    {sli: 'gecko.pending.build', resolution: '5m', met: v => v < 30 * MINUTE},
  ],
});

eb.declare({
  name: 'gecko.pending',
  description: [
    'Gecko pending times should be within their thresholds 99.5% of the time,',
    'measured over the previous two weeks.',
  ].join('\n'),
  nines: 95.0, // TEMPORARY
  days: 1,  // TEMPORARY
});

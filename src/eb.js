import collectorManager from './collectormanager';
import {sum} from 'lodash';

const MINUTE = 1000 * 60;
const HOUR = MINUTE * 60;
const DAY = 24 * HOUR;

/**
 * Declare an error budget.  This will declare and implement a collector based on the
 * given options.  An error budget analyzes an SLO over a given time period, and scales
 * from zero (SLO was missed more than allowed during that time period) to one (SLO was
 * met for the entire time period).
 *
 * options: {
 *  name: '..',         // name of the error budget (and underlying objective)
 *  description: '..',  // description of the error budget
 *  requires: [..],     // any additional loader components required
 *  nines: 99.9,        // the percent of time the objective should be met
 *  days: 14,           // the days over which to measure the percent
 * }
 */
exports.declare = ({name, description, requires, nines, days, testOnly}) => {
  // Time to delay after the top of an hour, to ensure that all datapoints are in.
  // SLIs can be delayed by 5 minutes, and SLOs by an additional 5, so wait 15.
  const DELAY = 15 * MINUTE;

  collectorManager.collector({
    name: `eb.${name}`,
    description,
    requires: ['monitor', 'clock', 'signalFxRest', 'ingest'].concat(requires || []),
    testOnly,
  }, function() {
    this.scheduleNextRun = () => {
      const now = this.clock.msec();
      // DELAY after the next even hour
      const nextRun = now - now % HOUR + HOUR + DELAY;

      const run = () => {
        this.scheduleNextRun();
        return this.calculate();
      };
      this.debug(`next calculation at ${new Date(nextRun)}`);
      this.clock.setTimeout(`calculate error budget for ${name}`, run, nextRun - now);
    };

    this.calculate = async () => {
      let now = this.clock.msec();
      now -= now % HOUR; // round down to the previous hour

      // fetch all data for the EB duration; this re-fetches data every hour, but in so
      // doing manages to catch any "late" data from the underlying SLO
      let startMs = now - days * DAY;
      let endMs = this.clock.msec();

      const history = [];
      (await this.signalFxRest.timeserieswindow({
        query: `sf_metric:slo.${name}`,
        startMs, endMs,
        resolution: HOUR,
      })).forEach(dp => history.push(dp));

      if (history.length > 2) {
        const last = history.length - 1;
        const dpString = i => `${history[i][1]} at ${new Date(history[i][0])}`;
        this.debug(`latest data from slo.${name}: [.., ${dpString(last-1)}, ${dpString(last)}]`);
      }

      // calculate the budget: 1.0 = never failed, 0.0 = failed more than the specified nines
      // note that missing data is treated as zero here
      const hoursMeasured = (now - history[0][0]) / HOUR;
      const hoursMet = sum(history.map(h => h[1]));
      const fractionExceeded = (hoursMeasured - hoursMet) / hoursMeasured;
      const maxFraction = (100 - nines) / 100;
      const budget = fractionExceeded > maxFraction ? 0 : 1 - fractionExceeded / maxFraction;

      const pctMet = 100-Math.round(fractionExceeded*10000)/100;
      this.debug(`Error budget for ${name} at ${new Date(now)} calculated at ${budget}: ` +
                 `SLO met ${hoursMet} of ${hoursMeasured} hours or ${pctMet}%`);
      this.ingest.send({
        gauges: [{
          metric: `eb.${name}`,
          value: budget,
          timestamp: now,
        }],
      });
    };

    this.scheduleNextRun();
  });
};

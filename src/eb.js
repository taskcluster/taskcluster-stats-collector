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
exports.declare = ({name, description, requires, nines, days}) => {
  // Time to delay after the top of an hour, to ensure that all datapoints are in.
  // SLIs can be delayed by 5 minutes, and SLOs by an additional 5, so wait 15.
  const DELAY = 15 * MINUTE;

  collectorManager.collector({
    name: `eb.${name}`,
    description,
    requires: ['monitor', 'clock', 'signalFxRest', 'ingest'].concat(requires || []),
  }, function () {
    const history = [];

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

      let earliest = now - days * DAY;

      // fetch new data and add to history
      let startMs = earliest;
      let endMs = this.clock.msec();
      if (history.length) {
        startMs = history[history.length - 1][0] + HOUR;
      }

      (await this.signalFxRest.timeserieswindow({
        query: `sf_metric:slo.${name}`,
        startMs, endMs,
        resolution: HOUR,
      })).forEach(dp => history.push(dp));

      // remove old history
      while (history[0] && history[0][0] < earliest) {
        history.shift();
      }

      // calculate the budget: 1.0 = never failed, 0.0 = failed more than the specified nines
      // note that missing data is treated as zero here
      const hoursMeasured = (now - history[0][0]) / HOUR;
      const hoursMet = sum(history.map(h => h[1]));
      const fractionExceeded = (hoursMeasured - hoursMet) / hoursMeasured;
      const maxFraction = (100 - nines) / 100;
      const budget = fractionExceeded > maxFraction ? 0 : 1 - fractionExceeded / maxFraction;

      this.debug(`Error budget for ${name} at ${new Date(now)} calculated at ${budget}`);
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

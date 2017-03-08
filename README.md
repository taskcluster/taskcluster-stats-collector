# Taskcluster Stats Collector

[![Build Status](https://travis-ci.org/taskcluster/taskcluster-stats-collector.svg?branch=master)](https://travis-ci.org/taskcluster/taskcluster-stats-collector)

Manages statistics collection for the TaskCluster team.

This tool is specific to the needs and expectations of TaskCluster as deployed at Mozilla, and embeds lots of assumptions into the code.
It is probably not useful outside that context.

# Data Collected

Data are collected by "collectors"

## `running` -- Running Tasks

* `tasks.<workerType>.resolved.<reasonResolved>` measures the time, in
  milliseconds, to resolve task with the given reason in the given workerType.
  Tasks are only measured when they are resolved, so this does not include
  times for running tasks.

## `pending` -- Pending Tasks

* `tasks.<workerType>.pending` measures the time that each task is pending.
  Tasks are measured constantly, even if they are still pending, making this a
  valid measure of the current pending time.

## Service Levels

This package calculates service levels.  The concepts for service levels are:

 * SLI -- service level indicator.  This is a single measurement of some level of interest.  An example might be an API error rate, measured on five-minute intervals.
 * SLO -- service level objective.  This is a boolean measurement of one or more SLIs: is each SLI within its parameters?  An example might be that the API error rate is less than 0.1%.
 * EB -- error budget.  This is a measure of how frequently an SLO is true.  This introduces "nines".  An example might be that the error-rate SLO is OK 99.9% of the time over a 2-week span.  An error budget runs from 1.0 (SLO never false) to 0.0 (not meeting the "nines" requirement).

The intended use of these calculations is to aim to spend error budgets, but
not *overspend*.  An SLO that never fails means that the team can afford to
move faster and break more stuff (or the SLO is a bad one) -- that budget is
1.0 and should be spent!  But as the budget nears zero, the team should slow
down and focus on reliability

In fact, there is great value in not hitting SLOs at all times, as occasional
failures force dependant services to handle failures correctly.

See the Google "Site Reliability Engineering" book for additional information
on service levels.

The service-level metrics available are:

 * `sli.gecko.pending.build` - pending time for gecko-related build workerTypes
   (95th percentile over 5 minutes)

 * `sli.gecko.pending.test` - pending time for gecko-related test workerTypes
   (95th percentile over 5 minutes)

 * `sli.gecko.pending.other` - pending time for gecko-related other
   workerTypes, including decision tasks and image generation (95th percentile
   over 5 minutes)

 * `slo.gecko.pending` - thresholds for `sli.gecko.pending.*` (see the source
   for threshold values)

 * `eb.gecko.pending` - error budget for `slo.gecko.pending`.

# Running locally

To run the server locally, compile (`yarn compile`) and then execute:

```
NODE_ENV=development DEBUG=* node lib/main server
```

Note that you can use `--collectors` to specify the collectors you would like
to run in development mode, thereby avoiding noise from collectors you're not
working on:

```
NODE_ENV=development DEBUG=* node lib/main server --collectors pending sli.gecko.pending.test
```


# Testing

First setup your `user-config.yml` based on `user-config-example.yml`. Then run

```
yarn test
```

# Service Owner

Service Owner: dustin@mozilla.com

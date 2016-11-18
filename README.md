# Taskcluster Stats Collector

[![Build Status](https://travis-ci.org/taskcluster/taskcluster-stats-collector.svg?branch=master)](https://travis-ci.org/taskcluster/taskcluster-stats-collector)

Manages statistics collection for the TaskCluster team.

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

# Running locally

To run the server locally, compile (`npm run compile`) and then execute:

```
NODE_ENV=development DEBUG=* node lib/main server
```

Note that you can also set ONLY_COLLECTOR to the name of a single collector to
run only that collector.


# Testing

First setup your `user-config.yml` based on `user-config-example.yml`. Then run

```
npm test
```

# Taskcluster Stats Collector

[![Build Status](https://travis-ci.org/taskcluster/taskcluster-stats-collector.svg?branch=master)](https://travis-ci.org/taskcluster/taskcluster-stats-collector)

Reads TaskCluster messages off pulse and creates relevant statistics.

# Data Collected

## Running Tasks

* `tasks.<workerType>.resolved.<reasonResolved>` measures the time, in
  milliseconds, to resolve task with the given reason in the given workerType.
  Tasks are only measured when they are resolved, so this does not include
  times for running tasks.

## Pending Tasks

* `tasks.<workerType>.pending` measures the time that each task is pending.
  Tasks are measured constantly, even if they are still pending, making this a
  valid measure of the current pending time.

# Testing

First setup your `user-config.yml` based on `user-config-example.yml`. Then run

```
npm test
```

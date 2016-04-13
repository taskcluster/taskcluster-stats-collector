#Taskcluster Stats Collector

[![Build Status](https://travis-ci.org/taskcluster/taskcluster-stats-collector.svg?branch=master)](https://travis-ci.org/taskcluster/taskcluster-stats-collector)

Reads taskcluster messages off pulse and stores relevant statistics into influxDB.


##Data Collected

All points are stored per run. 

Pending duration (scheduled->running): [duration,provisionerId,workerType,time=scheduled]

Running duration (running->finished): [duration,provisionerId,workerType,time=started]

Reason resolved: [count=1,reasonResolved,provisionerId,workerType,time=resolved]

##Testing

First setup your `user-config.yml` based on `user-config-example.yml`. Then run

```
npm test
```

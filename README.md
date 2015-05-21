#Taskcluster Stats Collector

##Purpose

Reads taskcluster messages off pulse and stores in influxDB relevant statistics for further reading.


##Data Collected

All points are stored per run. 

Pending duration (scheduled->running): [duration,provisionerId,workerType,time=scheduled]

Running duration (running->finished): [duration,provisionerId,workerType,time=started]

Reason resolved: [count=1,reasonResolved,provisionerId,workerType,time=resolved]


##Usage
```js
var collector = require('./lib/collector.js');
//By default, it listens to all taskcluster completed, failed, and exception messages
//We can also have it listen to messages with only certain routing keys
//check taskcluster-client for more info on how to do this
var col2 = new collector.Collector({
  connectionString: // InfluxDB connection string, look down for details
  credentials: {
    username: // Pulse Guardian username
    password: // Pulse Guardian password
  }
  routingKey: {provisionerId:'aws-provisioner-v1'}
  //or
  routingKey: {} //defaults to this
});
//Closes connections
col.close()
```

##Testing

First configure the following environment variables:

```
pulse_username = // Pulse Guardian username
pulse_password = // Pulse Guardian password
influxdb_connectionString = "<protocol>://<user>:<pwd>@<host>:<port>/db/<database>"
```

Then run

```
npm test
```

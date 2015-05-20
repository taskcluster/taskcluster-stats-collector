#Taskcluster Stats Collector

##Usage
```js
var collector = require('./lib/collector.js');
//By default, it listens to all taskcluster completed, failed, and exception messages
var col = new collector.Collector();
//We can also have it listen to messages with only certain routing keys, check taskcluster-client for more info on how to do this
var col2 = new collector.Collector({provisionerId:'aws-provisioner-v1'});
//Closes connections
col.close()
```

##Series
Pending duration (scheduled->running) for each run
columns:[duration,provisionerId,workerType]
Running duration (running->finished) for each run
columns:[duration,provisionerId,workerType]
Reason resolved for each run
columns:[count=1,reasonResolved,provisionerId,workerType]
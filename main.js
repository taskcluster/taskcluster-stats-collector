var debug = require('debug')('stats-collector:main');
var collector = require('./lib/collector.js');
var taskcluster = require('taskcluster-client')
var col = new collector.Collector({});

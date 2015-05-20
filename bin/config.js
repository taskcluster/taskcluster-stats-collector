var base = require('taskcluster-base');
module.exports = base.config({
  defaults: {},
  profile:  {},
  envs: [
    'pulse_username',
    'pulse_password',
    'influxdb_connectionString',
    'taskcluster_clientId',
    'taskcluster_accessToken'
  ],
  filename: 'collect'
});

const debug = require('debug')('test:test');
const assert = require('assert');
const TaskListener = require('../src/listener.js');
const slugid = require('slugid');
const taskcluster = require('taskcluster-client');
const monitoring = require('taskcluster-lib-monitor');
const libUrls = require('taskcluster-lib-urls');
const config = require('typed-env-config');

suite('TaskListener', function() {
  test('listens', async function() {

    const cfg = config({profile: 'test'});

    // Skip this test if no pulse credentials configured 
    if (!cfg.pulse.username) { // and the password can be empty
      this.skip();
    }

    const taskdefn = {
      provisionerId: 'stats-provisioner',
      workerType: 'stats-dummy',
      payload: {},
      created: taskcluster.fromNowJSON(),
      deadline: taskcluster.fromNowJSON('2 hours'),
      metadata: {
        name: 'Testing!',
        description: 'testing?',
        owner: 'eggylv999@gmail.com',
        source: 'https://github.com/taskcluster/taskcluster-stats-collector',
      },
    };

    assert(cfg.taskcluster.credentials.clientId && cfg.taskcluster.credentials.accessToken,
      'taskcluster credentials required');

    const monitor = await monitoring({
      projectName: 'tc-stats-collector',
      rootUrl: libUrls.testRootUrl(),
      credentials: {clientId: 'fake', accessToken: 'alsofake'},
      mock: true,
    });

    const listener = new TaskListener({
      rootUrl: libUrls.testRootUrl(),
      credentials: cfg.pulse,
      queueName: undefined,
      routingKey: {
        provisionerId: 'stats-provisioner',
      },
      monitor,
    });

    const task_messages = [];
    listener.on('task-message', ({action}) => task_messages.push(action));
    await listener.start();

    const id = slugid.v4();
    const queue = new taskcluster.Queue(cfg.taskcluster);

    const result = await queue.createTask(id, taskdefn);
    assert(result);
    debug('task created');

    await queue.claimTask(id, 0, {
      workerGroup:    'my-worker-group',
      workerId:       'my-worker',
    });
    debug('task claimed');

    await queue.reportException(id, 0, {reason: 'worker-shutdown'});
    debug('task exception');

    await queue.claimTask(id, 1, {
      workerGroup:    'my-worker-group',
      workerId:       'my-worker',
    });
    debug('task claimed again');

    await queue.reportCompleted(id, 1);
    debug('task completed');

    await listener.close();

    assert.deepEqual(task_messages, [
      'task-pending',
      'task-running',
      'task-pending',
      'task-running',
      'task-completed',
    ]);
  });
});


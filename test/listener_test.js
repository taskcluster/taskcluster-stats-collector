const debug = require('debug')('test:test');
const assert = require('assert');
const TaskListener = require('../src/listener.js');
const slugid = require('slugid');
const taskcluster = require('taskcluster-client');
const monitoring = require('taskcluster-lib-monitor');
const config = require('typed-env-config');

suite('TaskListener', function() {
  test('cares about Pulse credentials in production', async function() {
    const original_NODE_ENV = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    assert.doesNotThrow(() => {
      new TaskListener({
        credentials: {username: 'fakeuser', password: 'fakepassword'},
      });
    }, 'Good credentials');

    assert.throws(() => {
      new TaskListener({
        credentials: {username: '', password: ''},
      });
    }, 'Blank credentials');

    assert.throws(() => {
      new TaskListener({
        credentials: {username: 'fakeuser', password: ''},
      });
    }, 'Username with blank password');

    assert.throws(() => {
      new TaskListener({
        credentials: {username: 'fakeuser'},
      });
    }, 'Username only');

    assert.throws(() => {
      new TaskListener({
        credentials: {password: 'fakepassword'},
      });
    }, 'Password only');

    process.env.NODE_ENV = original_NODE_ENV;
  });

  test('mocks', async function() {
    assert.doesNotThrow(async function() {
      let listener = new TaskListener ({mock: true});
      await listener.start();
      await listener.close();
    }, 'mock: true');
  });

  test('listens', async function() {
    let cfg = config({profile: 'test'});

    // Skip this test if no pulse credentials configured 
    if (!cfg.pulse.username || !cfg.pulse.password) {
      this.skip();
    }

    var taskdefn = {
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

    let monitor = await monitoring({
      project: 'tc-stats-collector',
      credentials: {clientId: 'fake', accessToken: 'alsofake'},
      mock: true,
    });

    let listener = new TaskListener({
      credentials: cfg.pulse,
      queueName: undefined,
      routingKey: {
        provisionerId: 'stats-provisioner',
      },
      monitor,
    });

    let task_messages = [];
    listener.on('task-message', ({action}) => task_messages.push(action));
    await listener.start();

    var id = slugid.v4();
    var queue = new taskcluster.Queue({
      credentials: cfg.taskcluster.credentials,
    });

    let result = await queue.createTask(id, taskdefn);
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


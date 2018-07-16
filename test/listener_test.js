const debug = require('debug')('test:test');
const assert = require('assert');
const TaskListener = require('../src/listener.js');
const slugid = require('slugid');
const taskcluster = require('taskcluster-client');
const {FakeClient} = require('taskcluster-lib-pulse');
const monitoring = require('taskcluster-lib-monitor');
const libUrls = require('taskcluster-lib-urls');
const helper = require('./helper');

helper.secrets.mockSuite('TaskListener', ['pulse', 'taskcluster'], function(mock, skipping) {
  let client;
  const queueName = slugid.nice();

  suiteSetup('TaskListener', async function() {
    if (skipping()) {
      return;
    }

    if (mock) {
      helper.load.cfg('taskcluster.rootUrl', libUrls.testRootUrl());
      helper.load.inject('pulseClient', new FakeClient());
    } else {
      client = await helper.load('pulseClient');
    }
  });

  suiteTeardown('TaskListener', async function() {
    if (!mock && client) {
      await client.stop();
    }
  });

  test('listens', async function() {
    const cfg = await helper.load('cfg');

    const taskId = slugid.v4();
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

    const listener = await helper.load('listener');

    // listen only for this task
    listener.routingKey = {taskId, provisionerId: 'stats-provisioner'};
    // ..on a unique queue to avoid interfering with other test runs
    listener.queueName = queueName;
    // ..and use an exclusive queue so it will be deleted when we disconnect
    listener.queueOptions = {exclusive: true};

    const task_messages = [];
    listener.on('task-message', ({action}) => {
      debug(`received message with action ${action}`);
      task_messages.push(action);
    });
    await listener.start();

    if (mock) {
      // in the mock case, generate some fake messages
      const actions = [
        'task-pending',
        'task-running',
        'task-pending',
        'task-running',
        'task-completed',
      ];
      for (let action of actions) {
        await listener.consumer.fakeMessage({
          payload: {status: {taskId}},
          exchange: 'exchanges/fake-queue/' + action,
          routingKey: 'task.abc123',
          routes: [],
        });
      }
    } else {
      // in a real case, create a task and take it through its paces
      const queue = new taskcluster.Queue(cfg.taskcluster);

      const result = await queue.createTask(taskId, taskdefn);
      assert(result);
      debug('task created');

      await queue.claimTask(taskId, 0, {
        workerGroup:    'my-worker-group',
        workerId:       'my-worker',
      });
      debug('task claimed');

      await queue.reportException(taskId, 0, {reason: 'worker-shutdown'});
      debug('task exception');

      await queue.claimTask(taskId, 1, {
        workerGroup:    'my-worker-group',
        workerId:       'my-worker',
      });
      debug('task claimed again');

      await queue.reportCompleted(taskId, 1);
      debug('task completed');
    }

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


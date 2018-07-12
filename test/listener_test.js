const debug = require('debug')('test:test');
const assert = require('assert');
const TaskListener = require('../src/listener.js');
const slugid = require('slugid');
const taskcluster = require('taskcluster-client');
const monitoring = require('taskcluster-lib-monitor');
const libUrls = require('taskcluster-lib-urls');
const helper = require('./helper');

helper.secrets.mockSuite('TaskListener', ['pulse', 'taskcluster'], function(mock, skipping) {
  setup('TaskListener', function() {
    if (skipping()) {
      return;
    }
    if (mock) {
      helper.load.cfg('taskcluster.rootUrl', libUrls.testRootUrl());
    }
  });

  test('listens', async function() {
    const cfg = await helper.load('cfg');

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

    const monitor = await monitoring({
      projectName: 'tc-stats-collector',
      rootUrl: cfg.taskcluster.rootUrl,
      credentials: {clientId: 'fake', accessToken: 'alsofake'},
      mock: true,
    });

    const pulseCredentials = mock ? {fake: true} : cfg.pulse;
    const listener = new TaskListener({
      rootUrl: cfg.taskcluster.rootUrl,
      credentials: pulseCredentials,
      queueName: undefined,
      routingKey: {
        provisionerId: 'stats-provisioner',
      },
      monitor,
    });

    const task_messages = [];
    listener.on('task-message', ({action}) => task_messages.push(action));
    await listener.start();
    if (mock) {
      // in the mock case, generate some fake messages
      const fakePulse = listener.listener;
      const actions = [
        'task-pending',
        'task-running',
        'task-pending',
        'task-running',
        'task-completed',
      ];
      for (let action of actions) {
        fakePulse.fakeMessage({
          payload: {status: {taskId: 'abc123'}},
          exchange: 'exchanges/fake-queue/' + action,
          routingKey: 'task.abc123',
          routes: [],
        });
      }
    } else {
      // in a real case, create a task and take it through its paces
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


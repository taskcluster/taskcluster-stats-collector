const eb = require('../eb');

/* These collectors are only used for tests.  They specify testOnly, which means
 * that they are ignored when NODE_ENV=production */

eb.declare({
  testOnly: true,
  name: 'eb-test',
  description: 'EB Test',
  nines: 99,
  days: 2,
});

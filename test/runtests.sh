#!/bin/bash -ve
# node_modules/babel/bin/babel-node test/test.js
mocha \
    test/test.js

eslint \
  bin/collect.js   \
  lib/collector.js \
  lib/series.js
  
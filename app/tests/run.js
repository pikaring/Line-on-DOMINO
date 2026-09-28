// Node で自己テストを実行する: node tests/run.js
var path = require('path');
var base = path.join(__dirname, '..', 'js');
['tiles', 'board', 'ai', 'game', 'coach'].forEach(function (f) { require(path.join(base, f + '.js')); });
require('./tests.js');
var r = globalThis.DM_TEST_RESULT;
r.results.filter(function (x) { return !x.pass; }).forEach(function (x) {
  console.error('FAIL: ' + x.name + ' — ' + x.extra);
});
console.log(r.passed + ' / ' + r.total + ' passed');
process.exit(r.passed === r.total ? 0 : 1);

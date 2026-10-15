// Runs the probe files first, then the two files that look at the whole run (known-open, mutations).
const Sequencer = require("@jest/test-sequencer").default;
const last = (p) => (/mutations\.probe/.test(p) ? 2 : /known-open\.probe/.test(p) ? 1 : 0);
module.exports = class extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => last(a.path) - last(b.path) || (a.path < b.path ? -1 : 1));
  }
};

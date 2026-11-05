// Regenerates history.jsonl (run: node test/fixtures/make-history.js)
const fs = require('fs');
const path = require('path');
const L = [
  { display: 'first prompt', timestamp: 1000, project: 'C:\\a', sessionId: 'x' },
  'garbage',
  { display: 'Second about README', timestamp: 3000, project: 'C:\\b', sessionId: 'y' },
  { display: 'third', timestamp: 2000, project: 'C:\\a\\readme-proj', sessionId: 'z' },
];
fs.writeFileSync(path.join(__dirname, 'history.jsonl'),
  L.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n');

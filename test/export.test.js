const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseSessionFile } = require('../main/data/transcripts');
const { exportMarkdown } = require('../main/data/export');

test('exportMarkdown renders prompts, replies and tool calls', () => {
  const s = parseSessionFile(path.join(__dirname, 'fixtures', 'projects', 'C--proj-a', 's1.jsonl'));
  const md = exportMarkdown(s);
  assert.match(md, /^# Please fix the failing tests/);
  assert.match(md, /## User\n\nPlease fix/);
  assert.match(md, /## Assistant\n\nRunning tests/);
  assert.match(md, /\*\*Tool: Bash\*\*\n\n```json\n\{\n  "command": "npm test"/);
  assert.equal((md.match(/Running tests/g) || []).length, 1);
  assert.doesNotMatch(md, /local-command-caveat/);
});

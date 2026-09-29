const fs = require('fs');
const code = fs.readFileSync('/app/dist/assets/AgentEditor-Bd4wiy7w.js', 'utf-8');
// Find the Card extra section
const idx = code.indexOf('extra');
if (idx > -1) {
  console.log('Context around "extra":');
  console.log(code.substring(Math.max(0, idx - 200), idx + 300));
}
console.log('\n---\n');
// Find "调试" text
const idx2 = code.indexOf('调试');
if (idx2 > -1) {
  console.log('Context around "调试":');
  console.log(code.substring(Math.max(0, idx2 - 200), idx2 + 200));
} else {
  console.log('"调试" not found');
}

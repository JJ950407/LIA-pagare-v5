const { renderToFile } = require('./pdf');
const fs = require('fs');
(async () => {
  const mappingPath = 'config/mapping_v1.json';
  const payload = JSON.parse(fs.readFileSync('config/sample_input.json','utf8'));
  const out = `data/output/preview_${Date.now()}.pdf`;
  await renderToFile(mappingPath, payload, out);
  console.log('OK ->', out);
})();

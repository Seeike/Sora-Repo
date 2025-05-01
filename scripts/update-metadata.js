#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import https from 'https';
import { URL } from 'url';

// Perform a HEAD request, following redirects, to get Content-Length
function headRequest(url) {
  return new Promise((resolve, reject) => {
    const options = new URL(url);
    options.method = 'HEAD';

    const req = https.request(options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(headRequest(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to HEAD ${url}: ${res.statusCode}`));
      }
      const length = res.headers['content-length'];
      if (!length) {
        return reject(new Error('No Content-Length header in response'));
      }
      resolve(parseInt(length, 10));
    });

          // kill it after 10 seconds
      req.setTimeout(10_000, () => {
        reject(new Error(`HEAD ${url} timed out`));
        req.destroy();
     });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const jsonPath = 'sorarepo.json';
  const raw = await readFile(jsonPath, 'utf-8');
  const data = JSON.parse(raw);

  // Retrieve the IPA download URL from the JSON
  const downloadURL = data.apps[0].versions[0].downloadURL;

  console.log(`Fetching size for: ${downloadURL}`);
  const sizeBytes = await headRequest(downloadURL);
  const sizeMB = (sizeBytes / 1048576).toFixed(2) + ' MB';

  // Update fields in JSON
  data.apps[0].versions[0].size = sizeBytes;
  data.apps[0].size = sizeBytes;
  data.ipa_size = sizeMB;

  // Write back with pretty formatting
  await writeFile(jsonPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Updated ${jsonPath}: ${sizeBytes} bytes (${sizeMB})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

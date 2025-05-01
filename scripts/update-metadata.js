#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import https from 'https';
import { URL } from 'url';

/**
 * Perform a HEAD request (with redirects and timeout) to get Content-Length in bytes.
 */
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
        return reject(new Error(`No Content-Length header in response from ${url}`));
      }
      resolve(parseInt(length, 10));
    });

    // Timeout after 10 seconds
    req.setTimeout(10_000, () => {
      reject(new Error(`HEAD ${url} timed out`));
      req.destroy();
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetch the date of the latest GitHub Actions run (ISO string) for Seeike/Sora.
 */
async function fetchLatestRunDate() {
  const apiUrl = 'https://api.github.com/repos/Seeike/Sora/actions/runs?per_page=1';
  const res = await fetch(apiUrl, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'update-metadata-script' }
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  const { workflow_runs } = await res.json();
  if (!workflow_runs || workflow_runs.length === 0) {
    throw new Error('No workflow runs found for Seeike/Sora');
  }
  return workflow_runs[0].created_at;
}

async function main() {
  const jsonPath = 'sorarepo.json';
  const raw = await readFile(jsonPath, 'utf-8');
  const data = JSON.parse(raw);

  // 1. Resolve the raw download URL
  let downloadURL = data.apps[0].versions[0].downloadURL;
  let headURL = downloadURL;

  // Convert GitHub 'raw/refs/heads' URLs to raw.githubusercontent.com
  if (headURL.includes('github.com') && headURL.includes('/raw/refs/heads/')) {
    headURL = headURL
      .replace('https://github.com/', 'https://raw.githubusercontent.com/')
      .replace('/raw/refs/heads/', '/');
  }
  console.log(`Fetching size for: ${headURL}`);

  // 2. Fetch size
  const sizeBytes = await headRequest(headURL);
  const sizeMB = (sizeBytes / 1048576).toFixed(2) + ' MB';

  // 3. Fetch latest Actions run date
  const buildDate = await fetchLatestRunDate();
  console.log(`Latest build date: ${buildDate}`);

  // 4. Update JSON fields
  data.apps[0].versions[0].size = sizeBytes;
  data.apps[0].size = sizeBytes;
  data.apps[0].versions[0].date = buildDate;
  data.apps[0].versionDate = buildDate;
  data.ipa_size = sizeMB;
  data.lastBuildDate = buildDate;

  // 5. Write back with pretty formatting
  await writeFile(jsonPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Updated ${jsonPath}: ${sizeBytes} bytes (${sizeMB}), date ${buildDate}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
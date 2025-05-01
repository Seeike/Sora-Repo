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

  // Convert GitHub raw URL if necessary
  let headURL = data.apps[0].versions[0].downloadURL;
  if (headURL.includes('github.com') && headURL.includes('/raw/refs/heads/')) {
    headURL = headURL
      .replace('https://github.com/', 'https://raw.githubusercontent.com/')
      .replace('/raw/refs/heads/', '/');
  }
  console.log(`Fetching size for: ${headURL}`);

  // Fetch IPA size
  const sizeBytes = await headRequest(headURL);

  // Fetch latest workflow run date
  const buildDate = await fetchLatestRunDate();
  console.log(`Latest build date: ${buildDate}`);

  // Update version metadata
  data.apps[0].versions[0].size = sizeBytes;
  data.apps[0].versions[0].date = buildDate;
  data.apps[0].size = sizeBytes;
  data.apps[0].versionDate = buildDate;

  // Reconstruct JSON in desired shape
  const output = {
    name: data.name,
    identifier: data.identifier,
    iconURL: data.iconURL,
    apps: data.apps.map(app => ({
      name: app.name,
      bundleIdentifier: app.bundleIdentifier,
      developerName: app.developerName,
      iconURL: app.iconURL,
      localizedDescription: app.localizedDescription,
      subtitle: app.subtitle,
      tintColor: app.tintColor,
      versions: app.versions,
      size: app.size,
      version: app.version,
      versionDate: app.versionDate,
      downloadURL: app.downloadURL,
      appPermissions: app.appPermissions,
      screenshotURLs: app.screenshotURLs
    })),
    news: data.news || []
  };

  await writeFile(jsonPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`Updated ${jsonPath}: ${sizeBytes} bytes, buildDate ${buildDate}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

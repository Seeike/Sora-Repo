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
      // Redirects
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
 * Fetch the creation date of the latest GitHub Actions run for the IPA build workflow.
 */
async function fetchLatestRunDate() {
  // 1. List all workflows in the repo
  const workflowsRes = await fetch(
    'https://api.github.com/repos/Seeike/Sora/actions/workflows',
    { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'update-metadata-script' } }
  );
  if (!workflowsRes.ok) {
    throw new Error(`GitHub API error listing workflows: ${workflowsRes.status} ${workflowsRes.statusText}`);
  }
  const workflowsData = await workflowsRes.json();

  // 2. Identify the IPA build workflow
  const target = workflowsData.workflows.find(
    wf => wf.path.toLowerCase().includes('build') || wf.name.toLowerCase().includes('ipa')
  );
  if (!target) {
    throw new Error('Could not find IPA build workflow in Seeike/Sora');
  }

  // 3. Fetch the latest run for that workflow
  const runsRes = await fetch(
    `https://api.github.com/repos/Seeike/Sora/actions/workflows/${target.id}/runs?per_page=1`,
    { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'update-metadata-script' } }
  );
  if (!runsRes.ok) {
    throw new Error(`GitHub API error fetching runs: ${runsRes.status} ${runsRes.statusText}`);
  }
  const runsData = await runsRes.json();
  const runs = runsData.workflow_runs;
  if (!runs || runs.length === 0) {
    throw new Error(`No runs found for workflow id ${target.id}`);
  }

  return runs[0].created_at; // e.g., "2025-05-01T18:15:00Z"
}

async function main() {
  const jsonPath = 'sorarepo.json';
  const raw = await readFile(jsonPath, 'utf-8');
  const data = JSON.parse(raw);

  // Convert GitHub raw URL if needed
  let headURL = data.apps[0].versions[0].downloadURL;
  if (headURL.includes('github.com') && headURL.includes('/raw/refs/heads/')) {
    headURL = headURL
      .replace('https://github.com/', 'https://raw.githubusercontent.com/')
      .replace('/raw/refs/heads/', '/');
  }
  console.log(`Fetching size for: ${headURL}`);

  // Fetch IPA file size in bytes and MB
  const sizeBytes = await headRequest(headURL);
  console.log(`Size: ${sizeBytes} bytes (${(sizeBytes/1048576).toFixed(2)} MB)`);

  // Fetch the latest IPA build date
  const buildDate = await fetchLatestRunDate();
  console.log(`Latest build date: ${buildDate}`);

  // Update metadata in memory
  data.apps[0].versions[0].size = sizeBytes;
  data.apps[0].versions[0].date = buildDate;
  data.apps[0].size = sizeBytes;
  data.apps[0].versionDate = buildDate;

  // Reconstruct JSON structure
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
      downloadURL: app.versions[0].downloadURL,
      appPermissions: app.appPermissions,
      screenshotURLs: app.screenshotURLs
    })),
    news: data.news || []
  };

  // Write updated JSON back to file
  await writeFile(jsonPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`Updated ${jsonPath} with size ${sizeBytes} and date ${buildDate}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

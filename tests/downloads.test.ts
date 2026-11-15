/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';
import {setTimeout} from 'node:timers/promises';

import {BrowserManager} from '../src/BrowserManager.js';
import {HeapSnapshotManager} from '../src/processors/HeapSnapshotManager.js';
import {Locator} from '../src/third_party/index.js';
import {TaskRunner} from '../src/utils/TaskRunner.js';

import {createMockServerConfig} from './mocks.js';
import {serverHooks} from './server.js';
import {
  createConnectedMcpContext,
  createTempDir,
  getExecutablePath,
} from './utils.js';

async function waitForDownload(
  filePath: string,
  contents: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fs.readFile(filePath, 'utf8')) === contents) {
        return;
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      )) {
        throw error;
      }
    }
    await setTimeout(25);
  }
  assert.fail(`Timed out waiting for download ${filePath}`);
}

describe('download configuration', () => {
  const server = serverHooks();

  it('downloads files into the configured directory from default and isolated contexts', async () => {
    using dir = createTempDir('downloads-test-');
    const downloadPath = path.join(dir.path, 'downloads');
    const config = createMockServerConfig({
      isolated: true,
      headless: true,
      executablePath: await getExecutablePath(),
      downloadBehavior: 'allow',
      downloadPath,
    });
    await using manager = new BrowserManager(config);
    const browser = await manager.ensureBrowser();
    const heapSnapshotManager = new HeapSnapshotManager(new TaskRunner());
    const context = await createConnectedMcpContext(
      browser,
      {config, heapSnapshotManager},
      Locator,
    );

    try {
      for (const {name, page} of [
        {name: 'default', page: context.getSelectedMcpPage()},
        {name: 'isolated', page: await context.newPage(true, 'downloads')},
      ]) {
        const contents = `downloaded from ${name}`;
        server.addRoute(`/download/${name}.txt`, (_request, response) => {
          response.writeHead(200, {
            'Content-Type': 'text/plain',
            'Content-Disposition': `attachment; filename="${name}.txt"`,
          });
          response.end(contents);
        });
        server.addHtmlRoute(
          `/${name}`,
          `<a href="/download/${name}.txt">Download</a>`,
        );
        await page.pptrPage.goto(server.getRoute(`/${name}`));
        await page.pptrPage.click('a');
        await waitForDownload(path.join(downloadPath, `${name}.txt`), contents);
      }
    } finally {
      context.dispose();
      heapSnapshotManager.dispose();
    }
  });
});

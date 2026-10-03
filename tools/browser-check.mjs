// Optional browser verification; the app itself has no Playwright dependency.
// Set PLAYWRIGHT_MODULE to an existing Playwright package or module file.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an already installed Chromium browser.
import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, 'artifacts');
const baseUrl = new URL(process.env.TEST_URL || 'http://127.0.0.1:4173/');
if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

async function loadPlaywright() {
  const configured = process.env.PLAYWRIGHT_MODULE;
  if (!configured) {
    try {
      return await import('playwright');
    } catch {
      throw new Error('Browser checks need an existing Playwright install. Set PLAYWRIGHT_MODULE to its package directory or index.mjs.');
    }
  }
  let path = resolve(configured);
  if ((await stat(path)).isDirectory()) path = join(path, 'index.mjs');
  return import(pathToFileURL(path).href);
}

async function eventually(description, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}

const board = (view) => view.locator('[data-cell]').evaluateAll((cells) => cells.map((cell) => cell.dataset.mark));
const cell = (view, index) => view.locator(`[data-cell="${index}"]`);
const frame = (page, id) => page.frameLocator(`iframe[data-participant-id="${id}"]`);

async function expectBoard(view, expected) {
  await eventually(`board ${JSON.stringify(expected)}`, async () => JSON.stringify(await board(view)) === JSON.stringify(expected));
}

async function expectText(view, selector, expected) {
  await eventually(`${selector} to read ${expected}`, async () => (await view.locator(selector).textContent())?.trim() === expected);
}

async function expectDisabled(view, expected = true) {
  await eventually(`all cells ${expected ? 'disabled' : 'enabled'}`, async () => {
    const values = await view.locator('[data-cell]').evaluateAll((cells) => cells.map((cell) => cell.disabled));
    return values.length === 9 && values.every((value) => value === expected);
  });
}

async function ready(view) {
  await expectText(view, '#connection-label', 'Connected to Refract');
}

async function noHorizontalOverflow(page) {
  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(sizes.document <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1, `Horizontal overflow: ${JSON.stringify(sizes)}`);
}

let browser;
let page;
let checks = 0;
const errors = [];
async function check(name, run) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

try {
  const { chromium } = await loadPlaywright();
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) throw error;
    console.log('Using the configured installed Chromium browser.');
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir(artifacts, { recursive: true });
  await page.goto(baseUrl.href);
  await page.locator('#mode-local').click();

  await check('pass & play win, score, and winning squares', async () => {
    for (const index of [0, 3, 1, 4, 2]) await cell(page, index).click();
    await expectBoard(page, ['X', 'X', 'X', 'O', 'O', '', '', '', '']);
    await expectText(page, '#status', 'Player X wins!');
    await expectText(page, '#score-x', '1');
    assert.equal(await page.locator('.cell.winning').count(), 3);
    await expectDisabled(page);
    assert.equal(await page.locator('#next-round').isEnabled(), true);
  });

  await check('desktop and 390px mobile layout', async () => {
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(artifacts, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
  });

  await check('rematch preserves score and O starts', async () => {
    await page.locator('#next-round').click();
    await expectText(page, '#round', 'ROUND 02');
    await expectBoard(page, Array(9).fill(''));
    await expectText(page, '#score-x', '1');
    await cell(page, 4).click();
    await expectBoard(page, ['', '', '', '', 'O', '', '', '', '']);
  });

  await check('computer replies and returns control', async () => {
    await page.locator('#mode-computer').click();
    await cell(page, 0).click();
    await eventually('one computer reply', async () => {
      const values = await board(page);
      return values.filter((mark) => mark === 'X').length === 1 && values.filter((mark) => mark === 'O').length === 1;
    });
    await expectText(page, '#status', 'Your move');
    assert.equal(await page.locator('.cell:enabled').count(), 7);
  });

  await page.goto(new URL('tools/preview.html', baseUrl).href);
  const alex = frame(page, 1);
  const sam = frame(page, 2);
  const taylor = frame(page, 3);
  await ready(alex);
  await ready(sam);

  await check('embedded turns, synchronized win, and guest rematch', async () => {
    await expectDisabled(alex, false);
    await expectDisabled(sam);
    for (const [view, index] of [[alex, 0], [sam, 3], [alex, 1], [sam, 4], [alex, 2]]) {
      await cell(view, index).click();
    }
    const won = ['X', 'X', 'X', 'O', 'O', '', '', '', ''];
    await expectBoard(alex, won);
    await expectBoard(sam, won);
    await expectText(alex, '#score-x', '1');
    await expectText(sam, '#score-x', '1');
    await expectDisabled(alex);
    await expectDisabled(sam);
    await sam.locator('#next-round').click();
    await expectText(alex, '#round', 'ROUND 02');
    await expectText(sam, '#round', 'ROUND 02');
    await expectDisabled(alex);
    await expectDisabled(sam, false);
    await cell(sam, 4).click();
    await cell(alex, 0).click();
  });

  const inProgress = ['X', '', '', '', 'O', '', '', '', ''];
  await check('late spectator receives the board and cannot move', async () => {
    await page.locator('#toggle-spectator').click();
    await ready(taylor);
    await expectBoard(taylor, inProgress);
    await expectDisabled(taylor);
    await expectText(taylor, '#turn-tag', 'SPECTATING');
    assert.equal(await taylor.locator('#next-round').isDisabled(), true);
  });

  await check('theme update preserves all boards', async () => {
    await page.locator('#activity-theme').selectOption('light');
    for (const view of [alex, sam, taylor]) {
      await eventually('light activity theme', async () => await view.locator('html').getAttribute('data-theme') === 'light');
      await expectBoard(view, inProgress);
    }
  });

  await check('spectator departure and rejoin preserve the round', async () => {
    await page.locator('#toggle-spectator').click();
    await page.locator('iframe[data-participant-id="3"]').waitFor({ state: 'detached' });
    await expectBoard(alex, inProgress);
    await expectBoard(sam, inProgress);
    await expectText(sam, '#round', 'ROUND 02');
    await page.locator('#toggle-spectator').click();
    await ready(taylor);
    await expectBoard(taylor, inProgress);
  });

  await check('guest and host reload recover the same board and scores', async () => {
    for (const name of ['Sam', 'Alex']) {
      await page.getByRole('button', { name: `Refresh ${name}`, exact: true }).click();
      for (const view of [alex, sam, taylor]) {
        await ready(view);
        await expectBoard(view, inProgress);
        await expectText(view, '#score-x', '1');
        await expectText(view, '#round', 'ROUND 02');
      }
    }
  });

  await check('host departure migrates authority and promotes spectator', async () => {
    await alex.locator('#leave').click();
    await page.locator('iframe[data-participant-id="1"]').waitFor({ state: 'detached' });
    for (const view of [sam, taylor]) {
      await ready(view);
      await expectText(view, '#round', 'ROUND 03');
      await expectBoard(view, Array(9).fill(''));
      await expectText(view, '#score-x', '1');
    }
    await expectDisabled(sam);
    await expectDisabled(taylor, false);
    await cell(taylor, 2).click();
    await cell(sam, 4).click();
    for (const view of [sam, taylor]) await expectBoard(view, ['', '', 'X', '', 'O', '', '', '', '']);
  });

  await check('new preview session resets board, scores, and participants', async () => {
    await page.locator('#new-session').click();
    for (const view of [alex, sam, taylor]) {
      await ready(view);
      await expectBoard(view, Array(9).fill(''));
      await expectText(view, '#score-x', '0');
      await expectText(view, '#round', 'ROUND 01');
    }
    await expectDisabled(alex, false);
    await expectDisabled(sam);
    await expectDisabled(taylor);
  });

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  await page.screenshot({ path: join(artifacts, 'shared-preview.png'), fullPage: true });
  console.log(`${checks} browser checks passed. Screenshots: artifacts/desktop.png, artifacts/mobile.png, and artifacts/shared-preview.png`);
} catch (error) {
  if (page) {
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, 'browser-failure.png'), fullPage: true }).catch(() => {});
  }
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

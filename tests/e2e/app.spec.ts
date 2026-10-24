import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseImportText } from '../../src/storage/importExport';
import { sampleSnapshot } from '../unit/helpers';
import { COUNTS_A, COUNTS_EMPTY, exportText, fileA, fileB, gotoSettings, watchErrors } from './fixtures';

const SUB = 'http://127.0.0.1:4174/lab/v1/';

test.describe('骨架与导航', () => {
  test('六个页面都能打开，地址栏同步变化', async ({ page }) => {
    const check = watchErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '学习首页', level: 1 })).toBeVisible();
    const pages: Array<[string, string]> = [
      ['learn', '学习中心'],
      ['review', '间隔复习'],
      ['practice', '练习中心'],
      ['progress', '错题本'],
      ['settings', '设置'],
      ['dashboard', '学习首页'],
    ];
    for (const [path, title] of pages) {
      await page.getByTestId(`nav-${path}`).click();
      await expect(page).toHaveURL(new RegExp(`#/${path}$`));
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    }
    check();
  });

  test('深色主题使用需求文档规定的颜色', async ({ page }) => {
    await page.goto('/');
    // 用浏览器算出来的实际颜色（rgb）比较，避免 #fff 与 #ffffff 这类写法差异
    const colors = await page.evaluate(() => {
      const probe = (cssVar: string) => {
        const el = document.createElement('div');
        el.style.color = `var(${cssVar})`;
        document.body.appendChild(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        card: probe('--card'),
        accent: probe('--accent'),
        text: probe('--text'),
        muted: probe('--muted'),
      };
    });
    expect(colors).toEqual({
      bg: 'rgb(5, 5, 5)', // #050505 主背景
      card: 'rgb(23, 23, 25)', // #171719 卡片背景
      accent: 'rgb(198, 240, 0)', // #C6F000 强调色
      text: 'rgb(255, 255, 255)', // #FFFFFF 主文字
      muted: 'rgb(160, 160, 160)', // #A0A0A0 次级文字
    });
  });

  test('窄屏（手机宽度）：底部导航出现，页面不横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await gotoSettings(page, '/');
    const nav = await page.getByRole('navigation', { name: '主导航' }).boundingBox();
    expect(nav?.y ?? 0).toBeGreaterThan(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('存储与后备', () => {
  test('IndexedDB 不可用时：明确提示数据不会保存，页面仍可用', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    });
    await page.goto('/');
    await expect(page.getByTestId('storage-fallback-banner')).toContainText('刷新或关闭页面后数据会丢失');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('storage-status')).toContainText('临时内存');
  });
});

test.describe('导入导出验收', () => {
  test('初始状态：使用本机存储，记录数为 0', async ({ page }) => {
    await gotoSettings(page, '/');
    await expect(page.getByTestId('storage-status')).toContainText('IndexedDB');
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_EMPTY);
  });

  test('无效文件被拒绝，数据不变，并说明原因', async ({ page }) => {
    const check = watchErrors(page);
    await gotoSettings(page, '/');
    const input = page.getByTestId('import-file');

    await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{这不是json') });
    await expect(page.getByTestId('import-file-errors')).toContainText('不是有效的 JSON');

    const tampered = JSON.parse(await exportText(sampleSnapshot()));
    tampered.data.attempts[0].userAnswer = '被改过';
    await input.setInputFiles({ name: 'tampered.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered)) });
    await expect(page.getByTestId('import-file-errors')).toContainText('校验码不一致');

    const broken = JSON.parse(await exportText(sampleSnapshot()));
    delete broken.checksum;
    broken.data.attempts[1].outcome = 'maybe';
    await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) });
    await expect(page.getByTestId('import-file-errors')).toContainText('attempts[1]');

    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_EMPTY);
    check();
  });

  test('验收 1+2：预览 → 必须勾选确认 → 导入；刷新页面后数据仍在', async ({ page }) => {
    const check = watchErrors(page);
    await gotoSettings(page, '/');
    await page.getByTestId('import-file').setInputFiles(await fileA());

    // 预览阶段：只展示，不写入；未确认时不能导入
    const preview = page.getByTestId('import-preview');
    await expect(preview).toBeVisible();
    await expect(page.getByTestId('import-diff')).toContainText('作答记录');
    await expect(page.getByTestId('import-samples')).toContainText('She study English');
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_EMPTY);
    await expect(page.getByTestId('import-run')).toBeDisabled();

    await page.getByTestId('import-confirm').check();
    await expect(page.getByTestId('import-run')).toBeEnabled();
    await page.getByTestId('import-run').click();

    await expect(page.getByTestId('notice')).toContainText('导入完成');
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_A);
    await expect(page.getByTestId('backup-list').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('backup-list')).toContainText('导入前自动备份');

    // 刷新页面（重新加载网站），数据还在
    await page.reload();
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_A);
    await expect(page.getByTestId('backup-list').locator('li')).toHaveCount(1);
    check();
  });

  test('验收 4：导出的文件内容完整、校验通过，并且能恢复数据', async ({ page }) => {
    const check = watchErrors(page);
    // 下载的文件放到纯英文路径的临时目录：浏览器自动化选择文件时，含中文的路径会被静默忽略
    const dir = mkdtempSync(join(tmpdir(), 'english-lab-e2e-'));
    await gotoSettings(page, '/');
    await page.getByTestId('import-file').setInputFiles(await fileA());
    await page.getByTestId('import-confirm').check();
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_A);

    // 导出
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-btn').click()]);
    expect(download.suggestedFilename()).toMatch(/^english-lab-backup-\d{8}-\d{6}\.json$/);
    const path = join(dir, 'exported.json');
    await download.saveAs(path);
    const exported = await parseImportText(readFileSync(path, 'utf8'));
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      expect(exported.file.data).toEqual(sampleSnapshot());
      expect(exported.warnings).toEqual([]); // 有校验码且一致
    }

    // 用另一份数据“替换”掉本机数据，模拟数据被换掉或丢失
    await page.getByTestId('import-file').setInputFiles(await fileB());
    await page.getByText('替换', { exact: true }).click();
    await expect(page.getByTestId('import-warnings')).toContainText('删除本机');
    await page.getByTestId('import-confirm').check();
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('record-counts')).toHaveText('作答 1 · 复习卡 0 · 复习日志 0 · 设置 0');

    // 从导出的文件恢复（用刚才导出的真实文件，选“替换”）
    await page.getByTestId('import-file').setInputFiles(path);
    await page.getByText('替换', { exact: true }).click();
    await page.getByTestId('import-confirm').check();
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_A);

    // 再导出一次，内容与最初完全一致
    const [again] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-btn').click()]);
    const path2 = join(dir, 'exported2.json');
    await again.saveAs(path2);
    const second = await parseImportText(readFileSync(path2, 'utf8'));
    expect(second.ok && second.file.data).toEqual(sampleSnapshot());
    check();
  });

  test('从本机备份恢复：回到备份时的数据', async ({ page }) => {
    const check = watchErrors(page);
    await gotoSettings(page, '/');
    await page.getByTestId('import-file').setInputFiles(await fileA());
    await page.getByTestId('import-confirm').check();
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_A);

    // 导入 B（替换）之前，会自动备份“A 的状态”
    await page.getByTestId('import-file').setInputFiles(await fileB());
    await page.getByText('替换', { exact: true }).click();
    await page.getByTestId('import-confirm').check();
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('record-counts')).toHaveText('作答 1 · 复习卡 0 · 复习日志 0 · 设置 0');
    await expect(page.getByTestId('backup-list').locator('li')).toHaveCount(2);

    // 最新的一份备份 = 导入 B 之前的状态（A）
    await page.getByTestId('restore-btn').first().click();
    await expect(page.getByTestId('import-preview')).toContainText('本机备份');
    await expect(page.getByTestId('import-run')).toBeDisabled();
    await page.getByTestId('import-confirm').check();
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_A);
    await expect(page.getByTestId('backup-list')).toContainText('恢复前自动备份');
    check();
  });

  test('点“取消”不会改动任何数据', async ({ page }) => {
    await gotoSettings(page, '/');
    await page.getByTestId('import-file').setInputFiles(await fileA());
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_EMPTY);
    await expect(page.getByText('还没有备份')).toBeVisible();
  });
});

test.describe('静态部署兼容', () => {
  test('放在子目录（/lab/v1/）下：资源全部加载成功，路由、存储、导入都正常', async ({ page }) => {
    const bad: string[] = [];
    page.on('response', (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
    page.on('requestfailed', (r) => bad.push(`failed ${r.url()}`));
    const check = watchErrors(page);

    await page.goto(SUB);
    await expect(page.getByRole('heading', { name: '学习首页', level: 1 })).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await expect(page).toHaveURL(`${SUB}#/settings`);
    await expect(page.getByTestId('storage-status')).toContainText('IndexedDB');

    await page.getByTestId('import-file').setInputFiles(await fileA());
    await page.getByTestId('import-confirm').check();
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_A);
    await page.reload();
    await expect(page.getByTestId('record-counts')).toHaveText(COUNTS_A);

    // 页面里所有请求都只发往同一个站点（不依赖任何外部服务）
    const external = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((e) => e.name).filter((u) => !u.startsWith(location.origin)),
    );
    expect(external).toEqual([]);
    expect(bad).toEqual([]);
    check();
  });
});

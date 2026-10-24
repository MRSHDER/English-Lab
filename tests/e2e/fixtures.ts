import { expect, type Page } from '@playwright/test';
import { MemoryBackend } from '../../src/storage/memoryBackend';
import { createStore } from '../../src/storage/store';
import type { Snapshot } from '../../src/storage/schema';
import { buildExportFile, serializeExport } from '../../src/storage/importExport';
import { attempt, sampleSnapshot } from '../unit/helpers';

/** 用真实的导出逻辑生成一份导入文件的内容 */
export async function exportText(snapshot: Snapshot): Promise<string> {
  const store = createStore(new MemoryBackend(), 'memory', false);
  await store.replaceAll(snapshot);
  return serializeExport(await buildExportFile(store, new Date('2026-10-22T04:30:00.000Z')));
}

export const fileA = async () => ({
  name: 'english-lab-A.json',
  mimeType: 'application/json',
  buffer: Buffer.from(await exportText(sampleSnapshot())),
});

/** 另一份不同的数据：只有一条作答 */
export const fileB = async () => ({
  name: 'english-lab-B.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    await exportText({ attempts: [attempt(60, { promptSnapshot: '我喜欢画画。', userAnswer: 'I like painting.' })], cards: [], reviewLogs: [], settings: [] }),
  ),
});

/** 收集页面里的脚本错误，测试结束时必须为空 */
export function watchErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  return () => expect(errors, '页面不应出现脚本错误').toEqual([]);
}

export async function gotoSettings(page: Page, base = '') {
  await page.goto(`${base}#/settings`);
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible();
  await expect(page.getByTestId('record-counts')).not.toHaveText('读取中…');
}

export const COUNTS_A = '作答 3 · 复习卡 3 · 复习日志 2 · 设置 1';
export const COUNTS_EMPTY = '作答 0 · 复习卡 0 · 复习日志 0 · 设置 0';

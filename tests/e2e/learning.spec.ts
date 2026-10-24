import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from './fixtures';

interface RawItem { id: string; stem: string; cue?: string; answers: string[]; type: string }
const pack = JSON.parse(readFileSync(join(process.cwd(), 'content', 'grammar-core.json'), 'utf8')) as { items: RawItem[] };
const items = pack.items;
const topicItems = items.filter((i) => i.id.startsWith('q.present-simple.'));

/** 页面上显示的题干 → 标准答案（用于让测试像学生一样作答） */
const answerByDisplayedStem = new Map(
  items.map((i) => [i.stem.split('___').join('＿＿＿') + (i.cue ? ` (${i.cue})` : ''), i.answers[0] as string]),
);

async function currentAnswer(page: Page): Promise<string> {
  const text = (await page.getByTestId('q-stem').innerText()).replace(/\s+/g, ' ').trim();
  const a = answerByDisplayedStem.get(text);
  if (!a) throw new Error(`题库里找不到这道题：${text}`);
  return a;
}

async function answerRight(page: Page) {
  const ans = await currentAnswer(page);
  if ((await page.getByTestId('q-option').count()) > 0) await page.getByTestId('q-option').getByText(ans, { exact: true }).click();
  else await page.getByTestId('q-input').fill(ans);
  await page.getByTestId('q-submit').click();
}

async function answerFill(page: Page, text: string) {
  await page.getByTestId('q-input').fill(text);
  await page.getByTestId('q-submit').click();
}

/** 做一遍“一般现在时”：第 2 题答错（并标为手滑），第 3 题用提示，第 4 题“不知道”，第 5 题写成 dtudis，其余答对 */
async function practicePresentSimple(page: Page) {
  await page.goto('/#/practice/g.present-simple');
  await expect(page.getByTestId('q-progress')).toHaveText(`第 1 题 / 共 ${topicItems.length} 题`);
  for (let n = 1; n <= topicItems.length; n++) {
    if (n === 2) {
      await answerFill(page, 'like');
      await expect(page.getByTestId('q-result')).toHaveAttribute('data-outcome', 'wrong');
      await expect(page.getByTestId('q-correct')).toHaveText('likes');
      await expect(page.getByTestId('q-note')).toContainText('s');
      await page.getByTestId('classify-slip').click();
      await expect(page.getByTestId('classify-slip')).toHaveAttribute('aria-pressed', 'true');
    } else if (n === 3) {
      await page.getByTestId('q-hint-btn').click();
      await expect(page.getByTestId('q-hint')).toBeVisible();
      await answerRight(page);
      await expect(page.getByTestId('q-result')).toHaveAttribute('data-outcome', 'hinted');
    } else if (n === 4) {
      await page.getByTestId('q-dontknow').click();
      await expect(page.getByTestId('q-result')).toHaveAttribute('data-outcome', 'wrong');
    } else if (n === 5) {
      await answerFill(page, 'dtudis');
      await expect(page.getByTestId('q-result')).toHaveAttribute('data-outcome', 'wrong');
    } else {
      await answerRight(page);
      await expect(page.getByTestId('q-result')).toHaveAttribute('data-outcome', 'independent');
    }
    await page.getByTestId('q-next').click();
  }
  await expect(page.getByTestId('session-summary')).toBeVisible();
}

test.describe('学习闭环：做题 → 错题本 → 复习', () => {
  test('学习页显示规则，能进入练习', async ({ page }) => {
    const check = watchErrors(page);
    await page.goto('/#/learn');
    await expect(page.getByTestId('topic-link')).toHaveCount(5);
    await page.getByTestId('topic-link').first().click();
    await expect(page.getByTestId('topic-title')).toHaveText('一般现在时');
    await expect(page.locator('li', { hasText: '主语是 he / she / it' })).toBeVisible();
    await page.getByTestId('start-practice').click();
    await expect(page).toHaveURL(/#\/practice\/g\.present-simple$/);
    await expect(page.getByTestId('q-stem')).toBeVisible();
    check();
  });

  test('练一轮：判题、反馈、错因分类、结果汇总', async ({ page }) => {
    const check = watchErrors(page);
    await practicePresentSimple(page);
    // 9 题：第 2、4、5 题没有独立答对（第 3 题用了提示，算“答对”）
    await expect(page.getByTestId('summary-score')).toHaveText(`${topicItems.length - 3} / ${topicItems.length}`);
    check();
  });

  test('错题本：按错因分开统计，手滑不计入，刷新后仍在', async ({ page }) => {
    const check = watchErrors(page);
    await practicePresentSimple(page);
    await page.goto('/#/progress');
    await expect(page.getByTestId('errorbook-entry')).toHaveCount(3);
    await expect(page.getByTestId('stat-spelling').locator('.stat-n')).toHaveText('1'); // dtudis
    await expect(page.getByTestId('stat-grammar').locator('.stat-n')).toHaveText('0'); // like 被标为手滑
    await expect(page.getByTestId('stat-slips').locator('.stat-n')).toHaveText('1');
    await expect(page.getByTestId('stat-unclassified').locator('.stat-n')).toHaveText('1'); // 不知道
    await page.reload();
    await expect(page.getByTestId('errorbook-entry')).toHaveCount(3);

    // 在错题本里把“不知道”改为词汇问题
    const entry = page.getByTestId('errorbook-entry').filter({ hasText: '（不知道）' });
    await entry.getByTestId('eb-classify-vocabulary').click();
    await expect(page.getByTestId('stat-vocabulary').locator('.stat-n')).toHaveText('1');
    await expect(page.getByTestId('stat-unclassified').locator('.stat-n')).toHaveText('0');
    check();
  });

  test('第二天：答错和用了提示的题进入今日复习，复习完后清空', async ({ page }) => {
    const check = watchErrors(page);
    await practicePresentSimple(page);
    await page.goto('/#/review');
    await expect(page.getByTestId('review-empty')).toContainText('今天没有要复习的题');

    // 把浏览器时钟拨到 36 小时后，数据仍在 IndexedDB 里
    await page.clock.install({ time: new Date(Date.now() + 36 * 3600_000) });
    await page.reload();
    await expect(page.getByTestId('q-progress')).toHaveText(/第 1 题 \/ 共 [4-9] 题/);
    const total = Number(((await page.getByTestId('q-progress').innerText()).match(/共 (\d+) 题/) ?? [])[1]);
    expect(total).toBeGreaterThanOrEqual(4);
    for (let n = 0; n < total; n++) {
      await answerRight(page);
      await expect(page.getByTestId('q-result')).toHaveAttribute('data-outcome', 'independent');
      await page.getByTestId('q-next').click();
    }
    await expect(page.getByTestId('review-empty')).toContainText('今天的复习完成了');
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dash-due')).toContainText('0');
    check();
  });

  test('导出文件包含完整的作答、快照和复习日志（含算法参数）', async ({ page }) => {
    const check = watchErrors(page);
    await practicePresentSimple(page);
    await page.goto('/#/settings');
    await expect(page.getByTestId('record-counts')).toContainText(`作答 ${topicItems.length}`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-btn').click()]);
    const path = join(mkdtempSync(join(tmpdir(), 'elab-')), 'export.json');
    await download.saveAs(path);
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file.checksum.algorithm).toBe('sha-256');
    const dtudis = file.data.attempts.find((a: { userAnswer: string }) => a.userAnswer === 'dtudis');
    expect(dtudis.referenceAnswerSnapshot).toBe('studies');
    expect(dtudis.itemRevision).toBe(1);
    expect(dtudis.errors[0]).toMatchObject({ category: 'spelling', source: 'auto' });
    const log = file.data.reviewLogs[0];
    expect(log.algorithm.name).toBe('FSRS');
    expect(log.algorithm.libraryVersion).toMatch(/^ts-fsrs@/);
    expect(log.algorithm.parameters.length).toBeGreaterThanOrEqual(17);
    expect(file.data.cards.length).toBe(topicItems.length);
    check();
  });
});

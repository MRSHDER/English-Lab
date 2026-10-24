import { useEffect, useState } from 'preact/hooks';
import { library } from '../content';
import { dueToday, type DueEntry } from '../learning/queries';
import type { DataStore } from '../storage';
import { QuestionRunner } from '../ui/QuestionRunner';
import { dueLabel } from '../ui/format';

export function Review({ store }: { store: DataStore }) {
  const [queue, setQueue] = useState<DueEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { entries, total } = await dueToday(store, library);
        if (!alive) return;
        setQueue(entries);
        setTotal(total);
        if (entries.length === 0) {
          const future = (await store.cards.listAll())
            .filter((c) => !c.suspended && library.item(c.itemId))
            .map((c) => c.fsrs.due)
            .sort();
          if (alive) setNextDue(future[0] ?? null);
        }
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [store]);

  if (loadError) return <p class="msg-error" role="alert">读取复习计划失败：{loadError}</p>;
  if (!queue) return <p class="boot">读取复习计划…</p>;

  if (queue.length === 0 || index >= queue.length) {
    const finished = queue.length > 0;
    return (
      <div class="stack">
        <h1 class="page-title">间隔复习</h1>
        <section class="card" data-testid="review-empty">
          <h2>{finished ? `今天的复习完成了（${done} 题）` : '今天没有要复习的题'}</h2>
          {finished && total > queue.length && (
            <p class="hint">今天还有 {total - queue.length} 道到期的题超过了每日上限（{queue.length}），明天会继续出现。</p>
          )}
          {!finished && nextDue && <p class="hint">下一次复习：{dueLabel(nextDue)}。</p>}
          {!finished && !nextDue && <p class="hint">还没有复习计划。去练习几道题，做过的题会自动安排复习。</p>}
          <div class="row" style="margin-top:14px">
            <a class="btn primary" style="text-decoration:none;display:inline-flex;align-items:center" href="#/practice">去练习</a>
            <a class="btn" style="text-decoration:none;display:inline-flex;align-items:center" href="#/progress">看错题本</a>
          </div>
        </section>
      </div>
    );
  }

  const entry = queue[index]!;
  return (
    <div>
      <h1 class="page-title">间隔复习</h1>
      <p class="page-sub">不看提示，自己答。答错的题明天会再出现。</p>
      <QuestionRunner
        key={entry.item.id}
        store={store}
        item={entry.item}
        mode="review"
        progressText={`第 ${index + 1} 题 / 共 ${queue.length} 题`}
        nextLabel={index + 1 >= queue.length ? '完成' : '下一题'}
        onResult={() => setDone((d) => d + 1)}
        onNext={() => setIndex(index + 1)}
      />
    </div>
  );
}

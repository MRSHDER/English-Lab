import { useEffect, useState } from 'preact/hooks';
import { library } from '../content';
import { dueToday } from '../learning/queries';
import type { DataStore } from '../storage';

export function Dashboard({ store }: { store: DataStore }) {
  const [due, setDue] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const d = await dueToday(store, library);
      const n = (await store.countRecords()).attempts;
      if (alive) {
        setDue(d.total);
        setAttempts(n);
      }
    })();
    return () => {
      alive = false;
    };
  }, [store]);

  return (
    <div class="stack">
      <div>
        <h1 class="page-title">学习首页</h1>
        <p class="page-sub">目标：雅思 6.5，单项不低于 5.5</p>
      </div>
      <section class="card">
        <h2>今天</h2>
        <p style="font-size:1.4rem;margin:8px 0" data-testid="dash-due">
          待复习 <strong>{due ?? '…'}</strong> 题
        </p>
        <div class="row">
          <a class="btn primary" style="text-decoration:none;display:inline-flex;align-items:center" href="#/review" data-testid="dash-review">去复习</a>
          <a class="btn" style="text-decoration:none;display:inline-flex;align-items:center" href="#/learn">学新知识点</a>
          <a class="btn" style="text-decoration:none;display:inline-flex;align-items:center" href="#/progress">错题本</a>
        </div>
      </section>
      <p class="hint">累计作答 {attempts ?? '…'} 次。更详细的进度统计之后再加。</p>
    </div>
  );
}

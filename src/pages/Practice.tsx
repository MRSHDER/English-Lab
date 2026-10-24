import { useState } from 'preact/hooks';
import { library } from '../content';
import type { DataStore } from '../storage';
import { QuestionRunner } from '../ui/QuestionRunner';

export function Practice({ store, topicId }: { store: DataStore; topicId?: string | undefined }) {
  if (!topicId) {
    return (
      <div>
        <h1 class="page-title">练习中心</h1>
        <p class="page-sub">选一个知识点开始。答错的题会自动进入错题本和复习计划。</p>
        <ul class="stack topic-list">
          {library.topics.map((t) => (
            <li key={t.id}>
              <a class="card topic-card" href={`#/practice/${t.id}`} data-testid="practice-topic">
                <strong>{t.title}</strong> <span class="hint">{library.itemsOfTopic(t.id).length} 题</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const topic = library.topic(topicId);
  if (!topic) {
    return (
      <div>
        <h1 class="page-title">找不到这个知识点</h1>
        <p class="page-sub"><a href="#/practice">返回练习中心</a></p>
      </div>
    );
  }
  return <Session key={topicId} store={store} topicId={topicId} />;
}

function Session({ store, topicId }: { store: DataStore; topicId: string }) {
  const topic = library.topic(topicId)!;
  const items = library.itemsOfTopic(topicId);
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<('independent' | 'hinted' | 'wrong')[]>([]);
  const [round, setRound] = useState(0);

  if (index >= items.length) {
    const right = outcomes.filter((o) => o !== 'wrong').length;
    const wrongCount = outcomes.length - right;
    return (
      <div class="stack">
        <h1 class="page-title">{topic.title}：这一轮完成</h1>
        <section class="card" data-testid="session-summary">
          <p style="font-size:1.4rem"><strong data-testid="summary-score">{right} / {items.length}</strong> 答对</p>
          {wrongCount > 0 ? (
            <p class="hint" style="margin-top:6px">{wrongCount} 道答错的题已经放进错题本，并安排了复习。</p>
          ) : (
            <p class="hint" style="margin-top:6px">全部答对。这些题也已安排了复习，隔几天再确认一次是否真的记住了。</p>
          )}
          <div class="row" style="margin-top:14px">
            <button class="btn primary" onClick={() => { setIndex(0); setOutcomes([]); setRound(round + 1); }}>再练一轮</button>
            <a class="btn" style="text-decoration:none;display:inline-flex;align-items:center" href="#/progress" data-testid="to-errorbook">看错题本</a>
            <a class="btn" style="text-decoration:none;display:inline-flex;align-items:center" href="#/practice">返回练习中心</a>
          </div>
        </section>
      </div>
    );
  }

  const item = items[index]!;
  return (
    <div>
      <p><a href="#/practice">← 练习中心</a></p>
      <h1 class="page-title">{topic.title}</h1>
      <QuestionRunner
        key={`${round}-${item.id}`}
        store={store}
        item={item}
        mode="practice"
        progressText={`第 ${index + 1} 题 / 共 ${items.length} 题`}
        nextLabel={index + 1 >= items.length ? '看结果' : '下一题'}
        onResult={(r) => setOutcomes((o) => [...o, r.attempt.outcome])}
        onNext={() => setIndex(index + 1)}
      />
    </div>
  );
}

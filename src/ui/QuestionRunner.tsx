/** 做一道题：显示题目 → 作答 → 判题反馈。练习和复习共用 */
import { useRef, useState } from 'preact/hooks';
import type { Item } from '../content';
import { recordAnswer, setSelfClassification, type RecordResult, type SelfChoice } from '../learning/record';
import { ERROR_CATEGORY_LABELS } from '../storage';
import type { DataStore } from '../storage';
import { dueLabel } from './format';

const SELF_CHOICES: { value: SelfChoice; label: string }[] = [
  { value: 'grammar', label: ERROR_CATEGORY_LABELS.grammar },
  { value: 'spelling', label: ERROR_CATEGORY_LABELS.spelling },
  { value: 'vocabulary', label: ERROR_CATEGORY_LABELS.vocabulary },
  { value: 'unnatural', label: ERROR_CATEGORY_LABELS.unnatural },
  { value: 'meaning', label: ERROR_CATEGORY_LABELS.meaning },
  { value: 'slip', label: '手滑（我会，打错了）' },
];

export function StemView({ item }: { item: Item }) {
  const parts = item.stem.split('___');
  return (
    <p class="q-stem" data-testid="q-stem">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span class="blank" aria-label="空格">＿＿＿</span>}
        </span>
      ))}
      {item.cue && <span class="cue"> ({item.cue})</span>}
    </p>
  );
}

export interface QuestionRunnerProps {
  store: DataStore;
  item: Item;
  mode: 'practice' | 'review';
  /** 例如“第 2 题 / 共 9 题” */
  progressText: string;
  nextLabel: string;
  onResult?: (r: RecordResult) => void;
  onNext: () => void;
}

export function QuestionRunner({ store, item, mode, progressText, nextLabel, onResult, onNext }: QuestionRunnerProps) {
  const [answer, setAnswer] = useState('');
  const [hintShown, setHintShown] = useState(false);
  const [result, setResult] = useState<RecordResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selfChoice, setSelfChoice] = useState<SelfChoice | null>(null);
  const startedAt = useRef(Date.now());

  async function submit(text: string) {
    if (busy || result) return;
    setBusy(true);
    setError(null);
    try {
      const r = await recordAnswer(store, item, text, {
        mode,
        hintUsed: hintShown,
        durationMs: Date.now() - startedAt.current,
      });
      setResult(r);
      onResult?.(r);
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}。这道题没有被记录，可以再点一次。`);
    } finally {
      setBusy(false);
    }
  }

  async function classify(choice: SelfChoice) {
    if (!result) return;
    try {
      const updated = await setSelfClassification(store, result.attempt, choice);
      setResult({ ...result, attempt: updated });
      setSelfChoice(choice);
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const wrong = result?.attempt.outcome === 'wrong';
  const hinted = result?.attempt.outcome === 'hinted';

  return (
    <section class="card q-card" aria-live="polite">
      <div class="row spread">
        <span class="pill" data-testid="q-progress">{progressText}</span>
        <span class="pill">{mode === 'review' ? '复习' : '练习'}</span>
      </div>
      <StemView item={item} />
      {item.zh && <p class="q-zh">{item.zh}</p>}

      {!result && (
        <div>
          {item.type === 'fill' ? (
            <input
              class="q-input"
              data-testid="q-input"
              type="text"
              value={answer}
              placeholder="在这里输入答案"
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              enterKeyHint="done"
              aria-label="你的答案"
              onInput={(e) => setAnswer((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && answer.trim() !== '') void submit(answer);
              }}
              // 题目切换时由 key 重新创建，这里不需要手动清空
            />
          ) : (
            <div class="q-options" role="radiogroup" aria-label="选项">
              {item.options?.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={answer === o}
                  class={`q-option${answer === o ? ' selected' : ''}`}
                  data-testid="q-option"
                  onClick={() => setAnswer(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          {hintShown && item.hint && (
            <p class="q-hint" data-testid="q-hint">提示：{item.hint}</p>
          )}
          <div class="row" style="margin-top:14px">
            <button class="btn primary" data-testid="q-submit" disabled={busy || answer.trim() === ''} onClick={() => submit(answer)}>
              提交
            </button>
            {item.hint && !hintShown && (
              <button class="btn" data-testid="q-hint-btn" onClick={() => setHintShown(true)}>
                看提示
              </button>
            )}
            <button class="btn" data-testid="q-dontknow" disabled={busy} onClick={() => submit('')}>
              不知道
            </button>
          </div>
        </div>
      )}

      {error && <p class="msg-error" role="alert" style="margin-top:12px">{error}</p>}

      {result && (
        <div class={`q-result ${wrong ? 'bad' : 'good'}`} data-testid="q-result" data-outcome={result.attempt.outcome}>
          <p class="q-verdict">
            {wrong ? '✗ 这次没答对' : hinted ? '✓ 答对了（用了提示）' : '✓ 答对了'}
          </p>
          {wrong && (
            <dl class="kv">
              <dt>你的答案</dt>
              <dd>{result.attempt.userAnswer === '' ? '（不知道）' : result.attempt.userAnswer}</dd>
              <dt>正确答案</dt>
              <dd data-testid="q-correct">{item.answers.join(' / ')}</dd>
            </dl>
          )}
          {result.note && wrong && <p class="msg-warn" data-testid="q-note">{result.note}</p>}
          <p class="q-expl">{item.explanation}</p>

          {wrong && (
            <div class="q-classify" data-testid="q-classify">
              <p class="hint">这次错在哪？（可选，选了会覆盖程序的自动判断）</p>
              <div class="row">
                {SELF_CHOICES.map((c) => (
                  <button
                    key={c.value}
                    class={`btn small${selfChoice === c.value ? ' on' : ''}`}
                    aria-pressed={selfChoice === c.value}
                    data-testid={`classify-${c.value}`}
                    onClick={() => classify(c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p class="hint" data-testid="q-schedule" style="margin-top:10px">
            {result.scheduled && result.card
              ? `下次复习：${dueLabel(result.card.fsrs.due)}`
              : result.card
                ? `这道题已经安排了复习（${dueLabel(result.card.fsrs.due)}），今天重复练习不会改变日期。`
                : ''}
          </p>
          <div class="row" style="margin-top:12px">
            <button class="btn primary" data-testid="q-next" onClick={onNext}>
              {nextLabel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

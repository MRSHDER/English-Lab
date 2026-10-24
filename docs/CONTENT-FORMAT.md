# 内容包格式

内容放在 `content/*.json`，由 `src/content/schema.ts` 校验（程序启动时就校验，格式不对会直接报错）。
目前只有一个包：`content/grammar-core.json`（5 个语法点，45 题）。新增内容包时，在 `src/content/index.ts` 里把它加进 `buildLibrary([...])`。

## 结构

```json
{
  "format": "english-lab-content",
  "formatVersion": 1,
  "packId": "grammar-core",
  "title": "基础语法 5 点",
  "topics": [ { "id": "g.present-simple", "title": "...", "titleEn": "...", "summary": "...", "rules": ["..."], "examples": [{"en": "...", "zh": "..."}] } ],
  "items":  [ { "id": "q.present-simple.0005", "revision": 1, "topicId": "g.present-simple",
                "type": "fill", "stem": "She ___ English at night.", "cue": "study", "zh": "她晚上学英语。",
                "answers": ["studies"], "hint": "y 变成 ies。", "explanation": "...",
                "mistakes": [ { "text": "studys", "category": "grammar", "subtype": "y-to-ies", "note": "..." } ] } ]
}
```

- `type`：`fill`（填空，题干含 `___`）或 `choice`（选择，需要 `options`，答案必须是选项之一）。
- `answers`：所有可接受的答案，第一个是标准答案。比较时忽略大小写、句末标点、多余空格、弯引号。
- `mistakes`：已知的常见错误和对应的错因。学生输入它时，程序直接给出明确的错因和提醒。没登记的错误会是“待分类”，由学生自己选。
- 只在非常有把握时自动判“拼写”：答案长度至少 6 个字母且与学生输入只差 2 个以内的字母。短词（like / likes）不会被判成拼写。

## 更新题库的规则

1. ID 永远不改、不复用。
2. 改了题目内容（题干、答案、解释）：`revision` 加 1，ID 不变。历史作答里保存着当时的题面和答案快照，不受影响。
3. 不要了：加 `"deprecated": true`，不要删除。下架的题不再出现在练习和复习里，但历史记录和错题本仍能显示。
4. 题目 ID 必须以所属知识点开头：知识点 `g.present-simple` 的题是 `q.present-simple.0001`……

## 校验

`npm test` 会检查：格式、ID 重复、每道题的所有答案都能判对、每个登记的错误都不会被判对且错因一致。

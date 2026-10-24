# 稳定 ID 规则

目的：题库更新后，历史记录仍能关联到原内容。

## 内容 ID（人工命名，一经发布永不改名、永不复用）

格式：`^(g|q|v|r|t)\.[a-z0-9]+(?:[-.][a-z0-9]+)*$`

| 前缀 | 含义 | 例 |
|---|---|---|
| g | 语法点 | `g.present-simple` |
| q | 题目 | `q.present-simple.0001` |
| v | 词汇 | `v.run.1` |
| r / t | 预留（阅读 / 主题等） | — |

- 内容下线时不删 ID，只标记停用；内容改动但含义不变，递增 `itemRevision`，ID 不变。
- 作答记录保存 `promptSnapshot`、`referenceAnswerSnapshot`、`itemRevision`，即使题目后来被改写，历史仍可读。

## 复习卡 ID

`card.<itemId>`，一个内容对应一张卡。

## 记录 ID（自动生成）

`att_`（作答）、`log_`（复习日志）、`bak_`（备份）、`dev_`（设备）+ 10 位 36 进制时间 + 10 位随机，按时间大致有序，跨设备不冲突。

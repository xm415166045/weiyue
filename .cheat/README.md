# .cheat 工作区

内容预测引擎（cheat-engine）的赛前/赛后数据区。**预测段写后即锁，复盘段 T+3d 追加**。

## 目录
- `predictions/` — 每支内容一个 `YYYY-MM-DD_epNN_主题.md`（预测=锁，复盘=追加）
- `rubric_notes.md` — 评分维度微调（持续积累，跨集复用）
- `observations-archive.md` — 复盘沉淀的「规则/反模式/跳板」

## 内容台账
| 日期 | 集 | 主题 | 发布链接 | 复盘状态 |
| -------------------------------------- | ------ | -------- | ------------------- | --------------------- |
| 2026-07-06 | ep01 微阅 | 导出文件视频（PDF/MD/EPUB → 下载/微阅） | 待定 | 待定 |

## 使用
1. 出稿前：填 `predictions/` 的预测段，跑 `git add -A && git commit` 锁原生模块 sha
2. 发布后 T+3d：跑复盘，把结果追加到同文件复盘段
3. 沉淀规则：写 `observations-archive.md`，维度调整写 `rubric_notes.md`

## 规则（铁律）
- 预测段：写后即锁，改走 `_redo.md`
- 复盘段：T+3d 由 retro 追加，不手改预测段
- 锁死：`git show <sha>:.cheat/predictions/...` 可验原生模块指纹，防「预测漂移」

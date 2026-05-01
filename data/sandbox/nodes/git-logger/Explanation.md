# Git Logger

## 用途

获取 Git 仓库的提交历史日志，输出为文本。

## 配置

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| repoPath | string | 空（使用工作区） | Git 仓库路径 |
| maxCommits | number | 10 | 最大返回提交数 |

## 输出

Git log --oneline 格式的提交记录，每行一条。

---
kind: upgrade-guide
description: 插件 1.1.2 要求 DSH 0.2.1-alpha.2。
---

# 升级注解插件的宿主基线

[English](guide.md) | 中文

## 变更

插件 1.1.1 适配 DSH `0.2.1-alpha.1`。版本 1.1.2 要求 `>=0.2.1-alpha.2`，开发和验证均使用该发行版。浏览器存储 v6、提交协议 v5、草稿、回收站记录和已固定的重试内容沿用现有格式。

## 迁移

1. 确认宿主版本为 `0.2.1-alpha.2` 或更高。仍使用 `0.2.1-alpha.1` 时，请保留插件 1.1.1；按正常升级方式更新完整宿主。
2. 按 [README 命令](../../../../README.zh.md#installation)，将 1.1.2 GitHub Release 包安装到原有 Web profile。
3. 重启该 profile 正在运行的宿主，再刷新浏览器页面。保留浏览器站点数据、会话日志和 profile 设置。
4. 确认 `why dsh-annotation` 解析到 `1.1.2`。打开 **设置 → 注解**，检查原有偏好和会话记录。

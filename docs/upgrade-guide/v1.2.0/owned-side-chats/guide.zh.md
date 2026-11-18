---
kind: upgrade-guide
description: 从 1.2.0 升级至 1.3.0 时，宿主最低版本升至 0.2.2-rc.4。
---

# 侧聊归属与上下文

[English](guide.md) · 简体中文

## 变更

1.3.0 要求 DeepSeek Harness `>=0.2.2-rc.4` 和 Node.js `>=24.9.0`。继承上下文的侧聊还需要配套宿主提供工作区列表筛选和正文起点。官方 master 基线及公开发行版缺少工作区列表筛选时，会在新建前显示更新提示。

## 迁移

1. 更新 DeepSeek Harness 到 `0.2.2-rc.4` 或更新版本。使用继承上下文的侧聊时，应用[配套宿主补丁](https://github.com/ruisenbai/dsh-annotation/releases/download/v1.3.0/dsh-annotation-host-rc4.patch)并构建支持侧聊列表筛选（`uiWorkspace.registerSessionListFilter`）和正文起点（`chatTranscriptStart`）的构建，再安装 [1.3.0](https://github.com/ruisenbai/dsh-annotation/releases/tag/v1.3.0) 的宿主端和客户端插件。重新打开桌面版或刷新 Web 版。
2. 在原主会话的右侧栏打开已有标签。它们继续使用原记录。点击 **＋** 创建新侧聊，继承此时已经保存的历史。
3. 从原主会话进入侧聊。悬停标签可独立打开或归档，在侧栏的 **已归档** 中恢复。迁移旧标签时请保留浏览器站点数据，其中包含旧会话的关联和草稿。

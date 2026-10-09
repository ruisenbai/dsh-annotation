---
kind: upgrade-guide
description: 插件 1.1.1 要求 DSH 0.2.1-alpha.1 及其配套的 Cordis 依赖。
---

# 升级注解插件的宿主基线

[English](guide.md) | 中文

## 变更

插件 1.1.0 适配 DSH `0.2.0-rc.1`。插件 1.1.1 要求 `>=0.2.1-alpha.1`，已验证的宿主为 `0.2.1-alpha.1`，并使用配套的 Cordis 和 Schemastery 依赖。安装到 `0.2.0` 系列宿主可能无法通过依赖检查。浏览器存储 v6 和提交协议 v5 保持不变；草稿、已删除注解和已固定的重试内容沿用现有读取方式，无需额外转换数据。

## 迁移

1. 运行 `dsh --version`。目标宿主升级到 `0.2.1-alpha.1` 前，请保留插件 1.1.0；使用宿主正常的升级方式，不要单独修改官方依赖。
2. 按 [README 安装命令](../../../../README.zh.md#installation)安装 1.1.1 发行包，使用宿主对应的 Web profile。
3. 重启该 profile 的宿主并刷新浏览器页面，保留浏览器站点数据、会话日志和 profile 设置。
4. 运行 `dsh plugin --profile web why dsh-annotation`，将 profile 名称替换为实际值，确认版本为 `1.1.1`。在 **设置 → 注解** 中确认原有偏好，再打开会话检查保存的记录。

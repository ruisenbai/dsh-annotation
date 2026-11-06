---
kind: upgrade-guide
description: '注解插件 1.1.8 要求 DSH 0.2.2-rc.1，并兼容公开包及 master 的分组菜单。'
---

# 1.1.8 的宿主基线

[English](guide.md) | 中文

## 变更

最低宿主要求从 `0.2.2-alpha.3` 提升到 `0.2.2-rc.1`，Node.js 要求保持 `>=24.9.0`。源码验证基线为 master 提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`。master 的分组菜单通过 `Menu.anchorRef` 将实际气泡按钮交给 CSS 锚点定位机制；同一按钮也是 `returnFocus` 的目标，兼顾公开的 `0.2.2-rc.1` 包所提供的旧版菜单定位。插件不再传入已删除的矩形回调。

公开包名改为 `@bairuisen/dsh-annotation`；不带账号前缀的 npm 包名属于另一位维护者。设置条目 `dsh-annotation`、注解协议 v5、浏览器存储 v6、草稿、回收站记录和已固定的重试内容沿用现有标识及格式。较旧的 `0.2.2-alpha.3` 宿主继续使用插件 1.1.7。

## 迁移

1. Web 运行 `dsh --version`，Desktop 查看桌面版版本，安装 1.1.8 前必须达到 `0.2.2-rc.1` 或更新版本。全局 Web 命令行和 Desktop 内置运行时的版本可能不同。
2. 先停止目标 profile。若已安装旧包，运行 `dsh plugin --profile web remove dsh-annotation`，再用 `dsh plugin --profile web add @bairuisen/dsh-annotation@1.1.8 --registry=https://registry.npmjs.org` 安装新包。将 `web` 换为实际 profile 名称，两个包不能同时启用；镜像同步后也可改用 `--registry=https://registry.npmmirror.com`。用 `dsh plugin --profile web why @bairuisen/dsh-annotation` 确认解析到 1.1.8。[GitHub 安装包](https://github.com/ruisenbai/dsh-annotation/releases/tag/v1.1.8)仍可使用；[开发说明](../../../development.md)介绍本地构建方法。
3. 重启已安装的 profile 并刷新界面。选择普通正文及网页、文件链接文字，确认只出现一个包含“引用文本”和“添加注解”的操作栏。打开分组气泡并指定任意一条注解，检查滚动及 Escape 关闭时的菜单定位和焦点。
4. 刷新后确认原有注解、附加选择和已保存来源的定位功能仍可用。升级时不要清理浏览器存储。

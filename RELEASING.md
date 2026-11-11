# 发布插件

GitHub Releases 提供预构建安装包，dsh-market 从目录中的固定地址下载。请先在公开版宿主上验收；本机改过的宿主不能代表市场用户的环境。

## 准备与验证

1. 更新 `package.json` 中的版本与中文简介，检查宿主最低版本、依赖、中文首页、英文入口、升级说明和[更新记录](CHANGELOG.md)。
2. 按[开发与验证](docs/development.md)从锁文件安装依赖，运行类型检查、代码检查、测试、构建、覆盖率和浏览器验证。安装包还要在独立的 Web 配置下加载，并验证侧栏选区保存、原文定位、发送与恢复。
3. 检查安装包内的版本、许可、入口、截图和依赖，确保没有本机路径或凭据。生成版本化安装包、内容完全相同的固定文件名 `dsh-annotation.tgz`。交互原型单独提供，不放进插件运行包。

## 发布到 GitHub

将验证过的源码提交到插件仓库，提交合并请求并遵守默认分支的审核要求。标签必须等于 `v` 加上包版本。GitHub Release 可先以草稿附上已验证的两个安装包，再推送对应标签；如果没有预构建附件，仓库的 Release 工作流会从标签构建。

版本标题、正文和仓库简介优先使用中文。正文列出宿主要求、真实验证结果、升级限制及[兼容性说明](docs/compatibility.md)。发布后从 GitHub 下载两个安装包，验证 SHA-256 相同，并验证独立原型附件可以打开。

## 更新 dsh-market

按照[目录投稿规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)提交 `data/plugins/ruisenbai__dsh-annotation.yml`。保留 `session` 分类、中文一句话说明、必填英文翻译，以及 `https://github.com/ruisenbai/dsh-annotation/releases/latest/download/dsh-annotation.tgz`。不编辑自动生成的市场首页。目录合并并刷新后，再核对市场展示的简介和下载地址。

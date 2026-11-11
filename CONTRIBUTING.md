# 贡献指南

遇到问题先搜索[现有问题](https://github.com/ruisenbai/dsh-annotation/issues)和[讨论](https://github.com/ruisenbai/dsh-annotation/discussions)，并在[支持的宿主](docs/compatibility.md)上复现。示例请用虚构的选区和会话，不要附真实工作目录、账号凭据或聊天记录。安全问题请[私下报告](SECURITY.md)。

## 本地开发

```bash
git clone https://github.com/ruisenbai/dsh-annotation.git
cd dsh-annotation
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm verify
```

需要检查实际界面时，请按[开发与验证](docs/development.md)运行浏览器和真实 Web 配置测试。

## 提交改动

从 `main` 创建分支，一次合并请求解决一个问题。提交和合并请求优先用中文，说明用户看到的变化、兼容性和实际运行的检查。界面改动请附使用虚构数据的截图。

- 发送给模型的内容要能从标准会话日志还原。已发送的历史不可改写，注解和提交标识应保持稳定。
- 在读取文件或网络数据时完整校验，不静默截断所选文字。为状态转换、错误恢复和原文定位添加相应测试。
- 插槽、样式与订阅均应由插件负责释放。界面组件通过宿主提供的回调读取状态，面向用户的文字同时维护简体中文和英文。
- 行为、配置、数据格式或隐私有变化时，同步更新说明和升级指南。

参与贡献即同意遵守[社区行为准则](CODE_OF_CONDUCT.md)，并按项目的 [MIT 许可证](LICENSE)授权你的贡献。

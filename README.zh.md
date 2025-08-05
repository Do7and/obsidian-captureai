# 截图捕获插件

这是一个用于 Obsidian (https://obsidian.md) 的截图插件。

本项目使用 TypeScript 提供类型检查和文档。
仓库依赖于最新的插件 API (obsidian.d.ts) 的 TypeScript 定义格式，其中包含描述其功能的 TSDoc 注释。

该示例插件演示了插件 API 可以实现的一些基本功能：
- 添加一个功能区图标，点击时显示通知。
- 添加"打开示例模态框"命令来打开模态框。
- 在设置页面添加插件设置选项卡。
- 注册全局点击事件并向控制台输出 'click'。
- 注册全局间隔定时器并记录 'setInterval' 到控制台。

## 首次开发插件？

新插件开发者的快速入门指南：

- 查看[是否已有人开发了您想要的功能插件](https://obsidian.md/plugins)！可能已存在足够相似的插件，您可以与之合作。
- 使用"Use this template"按钮将此仓库作为模板进行复制（如果看不到该按钮，请登录 GitHub）。
- 将您的仓库克隆到本地开发文件夹。为方便起见，您可以将此文件夹放置在您的 `.obsidian/plugins/your-plugin-name` 文件夹中。
- 安装 NodeJS，然后在您的仓库文件夹下的命令行中运行 `npm i`。
- 运行 `npm run dev` 将您的插件从 `main.ts` 编译到 `main.js`。
- 对 `main.ts` 进行更改（或创建新的 `.ts` 文件）。这些更改应该会自动编译到 `main.js` 中。
- 重新加载 Obsidian 以加载新版本的插件。
- 在设置窗口中启用插件。
- 对于 Obsidian API 的更新，在您的仓库文件夹下的命令行中运行 `npm update`。

## 发布新版本

- 在您的 `manifest.json` 中更新您的新版本号，例如 `1.0.1`，以及您的最新版本所需的最低 Obsidian 版本。
- 使用 `"new-plugin-version": "minimum-obsidian-version"` 更新您的 `versions.json` 文件，以便旧版本的 Obsidian 可以下载与之兼容的旧版本插件。
- 使用您的新版本号作为"标签版本"创建新的 GitHub 发布。使用确切的版本号，不要包含前缀 `v`。示例请参见：https://github.com/obsidianmd/obsidian-sample-plugin/releases
- 上传文件 `manifest.json`、`main.js`、`styles.css` 作为二进制附件。注意：manifest.json 文件必须在两个地方，首先是您仓库的根路径，也在发布中。
- 发布该版本。

> 您可以通过在 `manifest.json` 中手动更新 `minAppVersion` 后运行 `npm version patch`、`npm version minor` 或 `npm version major` 来简化版本提升过程。
> 该命令将在 `manifest.json` 和 `package.json` 中提升版本，并将新版本的条目添加到 `versions.json` 中

## 将您的插件添加到社区插件列表

- 查看[插件指南](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)。
- 发布初始版本。
- 确保您的仓库根目录中有 `README.md` 文件。
- 在 https://github.com/obsidianmd/obsidian-releases 提交拉取请求以添加您的插件。

## 如何使用

- 克隆此仓库。
- 确保您的 NodeJS 至少为 v16（`node --version`）。
- `npm i` 或 `yarn` 安装依赖项。
- `npm run dev` 启动监视模式编译。

## 手动安装插件

- 将 `main.js`、`styles.css`、`manifest.json` 复制到您的库 `VaultFolder/.obsidian/plugins/your-plugin-id/`。

## 使用 eslint 提高代码质量（可选）
- [ESLint](https://eslint.org/) 是一种分析您的代码以快速发现问题的工具。您可以对插件运行 ESLint 以查找常见错误和改进代码的方法。
- 要在该项目中使用 eslint，请确保从终端安装 eslint：
  - `npm install -g eslint`
- 要使用 eslint 分析此项目，请使用此命令：
  - `eslint main.ts`
  - eslint 然后会按文件和行号创建一个包含代码改进建议的报告。
- 如果您的源代码在文件夹中，例如 `src`，您可以使用此命令对该项目中的所有文件使用 eslint：
  - `eslint .\src\`

## 资助 URL

您可以包含资助 URL，让使用您插件的人可以对其进行经济支持。

简单的方法是在您的 `manifest.json` 文件中将 `fundingUrl` 字段设置为您的链接：

```json
{
    "fundingUrl": "https://buymeacoffee.com"
}
```

如果您有多个 URL，也可以这样做：

```json
{
    "fundingUrl": {
        "Buy Me a Coffee": "https://buymeacoffee.com",
        "GitHub Sponsor": "https://github.com/sponsors",
        "Patreon": "https://www.patreon.com/"
    }
}
```

## API 文档

参见 https://github.com/obsidianmd/obsidian-api
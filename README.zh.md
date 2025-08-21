
<h1 align="center">CaptureAI</h1>

<div align="center">
  <img src="captureai-logo.svg?raw=true" width="120" height="120" alt="CaptureAI Logo">
  <h3 style="margin-top: 0px;">Capture, Analyze, and Organize Visual Information with AI</h3>
</div>

<!-- 这是一个注释，在渲染后的页面中不会显示 [![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22captureai%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=flat-square)](https://obsidian.md/plugins?id=captureai)-->

<div align="center">

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-blueviolet?style=flat-square&logo=obsidian)](https://obsidian.md/plugins?id=captureai)
[![GitHub release](https://img.shields.io/github/v/release/Do7and/captureai?style=flat-square&sort=semver)](https://github.com/Do7and/captureai/releases)
[![GitHub Stars](https://img.shields.io/github/stars/Do7and/captureai?style=flat-square)](https://github.com/Do7and/captureai/stargazers)
[![License: AGPL 3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg?style=flat-square)](https://www.gnu.org/licenses/agpl-3.0.en.html)

</div>



---

**CaptureAI** 是一款强大的 Obsidian 插件，支持截图捕获和 AI 智能分析，改变你与视觉内容的交互方式，提升你的知识管理效率。

---

<div align="center">

[English](README.md) | 简体中文

</div>


## ✨ 为什么选择 CaptureAI？

· **很多截图只是临时使用，却还要手动保存上传并在事后清理？**  
  CaptureAI 在 Obsidian 内部即可截图并直接发送给 AI，无需额外保存，临时截图随用随走，更契合截图的使用习惯。  

· **遇到不方便复制的 PDF、图表，或是视频中的某一帧，但又想让 AI 来帮忙？**  
  截图就是最好的媒介。目前的 Vision 模型已经可以处理大部分日常需求，CaptureAI 让截图成为与 AI 沟通的直通车，让复杂内容也能顺畅进入对话。  

· **厌倦了频繁的 Copy & Paste？**  
  CaptureAI 的「魔法拖拽区」让你只需拖动文字或图片，就能快速发给 AI，减少重复操作，更贴合笔记流的体验。  

· **对话中产生了有用的信息，却担心之后找不到，或是想下次接着聊？**  
  CaptureAI 的核心理念是「会话即笔记」。AI 的消息可直接插入当前笔记，也能整体保存为独立笔记，同时支持加载会话，随时恢复上下文，让对话自然延续。


## 功能特性

### 📸 高级截图捕捉
- 支持区域截图，直观的选区工具  
- 预览时可编辑：画笔、高亮、形状工具  
- 直接拖动边缘调整截图区域，无需额外裁剪  

### 🤖 AI 集成与分析
- 支持多种 AI 模型（OpenAI、Anthropic、Google、自定义）  
- 自动识别视觉模型能力并智能选择  
- 四种工作模式：分析（Analyze）、文字识别（OCR）、对话（Chat）、自定义（Custom）  
- 支持基于图像的上下文对话  
- 系统提示词可定制，适配多场景需求  
- 特殊样式的“思考/推理”内容块  

### 💬 增强型对话界面
- 消息块设计，配备快捷操作按钮  
- 支持插入光标、复制、编辑/阅读切换、删除  
- 支持 LaTeX 与 Markdown 渲染  
- 切换模型时保持上下文  
- 会话与笔记之间自动匹配模型  

### 🖼️ 智能图像管理
- 多来源图像管理：  
  - 截图捕获  
  - 从 Markdown 文件拖入  
  - 从 Vault 拖入  
  - 从外部浏览器或网页拖入  
  - 文件浏览器选择  
- 支持 Base64 临时图片，无需存储到 Vault  
- 保存会话时自动保存到指定路径  
- 智能复制并自动处理路径  

### 📝 智能会话管理
- 自动保存会话并检测变更  
- 手动保存并自定义命名  
- 支持创建/修改时间追踪  
- 会话与笔记双向同步  

---

## 工作流程

1. **捕捉**：用区域捕获工具选择屏幕任意区域  
2. **编辑**：用绘图工具标注截图  
3. **分析**：选择 AI 模式发送分析  
4. **对话**：基于图像上下文进行交流  
5. **整理**：保存会话为笔记或访问历史记录  

---

## 安装方式

### 从 Obsidian 社区插件安装（❌即将上线）
1. 打开 Obsidian  
2. 进入 设置 > 社区插件  
3. 关闭“安全模式”  
4. 点击“浏览”并搜索 CaptureAI（插件正在审核中）  
5. 安装并启用插件  

### 手动安装 ✅
1. 下载最新版本压缩包  
2. 解压到 Vault 的 `.obsidian/plugins/captureai` 文件夹  
3. 重启 Obsidian  
4. 在 设置 > 社区插件 中启用 CaptureAI  

### 使用 BRAT 插件添加 ✅
1. 打开 Obsidian  
2. 进入 设置 > 社区插件  
3. 关闭“安全模式”  
4. 搜索并安装 BRAT  
5. 在 BRAT 设置中配置 GitHub Personal Access Token  
6. 选择 “Add beta plugin”，添加：`do7and/obsidian-captureai`  

---

## 配置

### AI 模型设置
1. 打开 设置 > CaptureAI  
2. 配置各 AI 服务 API Key  
3. 管理与添加支持视觉的模型  
4. 设置各模式的默认模型  

### 图像处理
- 设置截图保存路径  
- 配置临时图片大小限制  
- 定义其他来源图片的存储路径  
- 自定义复制时的输出格式  

### 界面自定义
- 调整快捷键  
- 配置界面显示偏好  
- 设置自动保存参数  

---

## 使用场景示例

### 学术研究
- 截取教材页并用 OCR 提取文字  
- 分析图表获取数据  
- 用 AI 生成注释笔记  

### 编程辅助
- 截取代码并获取解释或建议  
- UI 设计反馈  
- 结合视觉参考记录调试过程  

### 创意工作
- 设计稿标注反馈  
- 分析视觉内容助力创作  
- 用 AI 标签整理灵感  

---

## 开发计划

- [ ] 修复已知问题  

---

## 参与贡献

欢迎贡献！流程如下：  
1. Fork 本仓库  
2. 新建分支 (`git checkout -b feature/AmazingFeature`)  
3. 提交代码 (`git commit -m 'Add some AmazingFeature'`)  
4. 推送分支 (`git push origin feature/AmazingFeature`)  
5. 提交 Pull Request  

---

## 技术支持

- 🐛 在 [GitHub Issues](https://github.com/Do7and/captureai/issues) 提交问题  
- 💡 在 [GitHub Discussions](https://github.com/Do7and/captureai/discussions) 提建议  

---

## 许可证

版权所有 © 2025 Do7and  

本项目使用 GNU Affero 通用公共许可证 第3版（AGPL-3.0）授权。  
查看完整许可证：[AGPL v3.0](https://www.gnu.org/licenses/agpl-3.0.en.html)  

---

## 致谢

- 感谢 Obsidian 团队打造优秀的知识管理平台  
- 灵感来源于 AI 与个人知识管理的结合  
- 图标来自 Lucide Icons  
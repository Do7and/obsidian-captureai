# CaptureAI - Obsidian Plugin

<p align="center">
  <img src="captureai-logo.svg" width="120" height="120" alt="CaptureAI Logo" />
  <h3 align="center">Capture, Analyze, and Organize Visual Information with AI</h3>
</p>

[![GitHub release](https://img.shields.io/github/release/Do7and/captureai.svg)](https://github.com/Do7and/captureai/releases)
[![AGPL License 3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0.en.html)

---

**CaptureAI** 是一款强大的 Obsidian 插件，支持截图捕获和 AI 智能分析，改变你与视觉内容的交互方式，提升你的知识管理效率。

---
English | [简体中文](README.zh-CN.md) 


## Features

### 📸 Advanced Screenshot Capture
- 支持区域截图，直观的选区工具
- 预览时编辑：画笔、高亮、形状工具
- 直接拖动边缘调整截图区域，无需额外裁剪工具

### 🤖 AI Integration & Analysis
- 多 AI 模型支持（OpenAI、Anthropic、Google、自定义）
- 自动识别视觉模型能力，智能选择
- 四种工作模式：Analyze、OCR、Chat、Custom
- 支持图像上下文对话
- 系统提示词定制，满足多场景需求
- 思考/推理块特殊样式与处理

### 💬 Enhanced Chat Interface
- 消息块设计，配备操作按钮
- 支持插入光标、复制、编辑/阅读视图切换、删除
- 支持 LaTeX 和 Markdown 渲染
- 模型切换时上下文保持 
- 会话与笔记的对应模型

### 🖼️ Intelligent Image Management
- 多来源图像管理：
  - 来自截图
  - 从 Markdown 文件拖入
  - Vault 中拖入图片
  - 外部文件浏览器/网页拖入
  - 文件浏览器选择
- 支持Base64临时图片，无需存储到 Vault
- 保存会话时自动保存到配置路径
- 智能复制，路径自动处理

### 📝 Smart Conversation Management
- 自动保存会话，带变更检测
- 手动保存并自定义命名
- 支持创建及修改时间戳追踪
- 会话与笔记双向同步

---

## How It Works

1. **Capture**：用区域捕获工具选择屏幕任意区域  
2. **Edit**：用多种绘图工具标注截图  
3. **Analyze**：选择四种 AI 模式之一发送分析  
4. **Converse**：基于图像上下文进行智能对话  
5. **Organize**：保存会话为笔记或从历史访问

---

## Installation

### From Obsidian Community Plugins (Coming Soon)
1. 打开 Obsidian  
2. 进入设置 > 社区插件  
3. 关闭「安全模式」  
4. 点击「浏览」搜索 CaptureAI  
5. 点击安装  
6. 安装完成后启用插件  

### Manual Installation
1. 下载最新版本压缩包  
2. 解压到 Vault 的 `.obsidian/plugins/captureai` 文件夹  
3. 重启 Obsidian  
4. 设置 > 社区插件中启用 CaptureAI  

---

## Configuration

### AI Model Setup
1. 进入设置 > CaptureAI  
2. 配置各 AI 服务的 API Key  
3. 管理和添加支持视觉能力的模型  
4. 设定各操作模式默认模型

### Image Handling
- 设置截图保存路径  
- 配置临时图片大小限制  
- 定义其他图片源的存储路径  
- 自定义复制时的格式

### UI Customization
- 调整快捷键  
- 配置界面显示偏好  
- 设定自动保存参数

---

## Usage Examples

### Academic Research
- 截取教科书页并用 OCR 提取文字  
- 分析图表获取数据洞察  
- 用 AI 生成带注释的学习笔记  

### Programming Assistance
- 截取代码片段，获取说明和建议  
- UI 设计反馈  
- 结合视觉参考记录调试过程  

### Creative Work
- 设计稿标注反馈  
- 分析视觉内容助力创作  
- 利用 AI 标签整理视觉灵感  

---


## Roadmap

- [ ] 修bug  

---

## Contributing

欢迎贡献！请按照以下步骤：

1. Fork 本仓库  
2. 新建分支 (`git checkout -b feature/AmazingFeature`)  
3. 提交代码 (`git commit -m 'Add some AmazingFeature'`)  
4. 推送分支 (`git push origin feature/AmazingFeature`)  
5. 提交 Pull Request  

---

## Support

- 🐛 在 [GitHub Issues](https://github.com/Do7and/captureai/issues) 报告问题  
- 💡 在 [GitHub Discussions](https://github.com/Do7and/captureai/discussions) 提建议  

---

## License

版权所有 © 2025 Do7and

本项目采用 GNU Affero 通用公共许可证 第3版（AGPL-3.0）授权。  
许可证全文请见：[AGPL v3.0 许可证](https://www.gnu.org/licenses/agpl-3.0.en.html)。

---

## Acknowledgments

- 感谢 Obsidian 团队打造优秀的知识管理平台  
- 灵感来源于 AI 与个人知识管理的交叉发展  
- 图标来自 Lucide Icons 库

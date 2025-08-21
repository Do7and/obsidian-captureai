# CaptureAI - Obsidian Plugin

<div align="center">
  <img src="captureai-logo.svg?raw=true" width="120" height="120" alt="CaptureAI Logo">
  <h3 style="margin-top: 0px;">Capture, Analyze, and Organize Visual Information with AI</h3>
</div>
<div align="center">

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-blueviolet?style=flat-square&logo=obsidian)](https://obsidian.md/plugins?id=captureai)
[![GitHub release](https://img.shields.io/github/v/release/Do7and/captureai?style=flat-square&sort=semver)](https://github.com/Do7and/captureai/releases)
[![GitHub Stars](https://img.shields.io/github/stars/Do7and/captureai?style=flat-square)](https://github.com/Do7and/captureai/stargazers)
[![License: AGPL 3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg?style=flat-square)](https://www.gnu.org/licenses/agpl-3.0.en.html)


</div>

---

**CaptureAI** is a powerful Obsidian plugin that supports screenshot capture and AI-powered analysis, transforming the way you interact with visual content and improving your knowledge management efficiency.

---

<div align="center">

English | [简体中文](README.zh.md)

</div>

## ✨ Why CaptureAI?

· **Many screenshots are only needed temporarily, but still require saving, uploading, and later cleaning up?**  
  With CaptureAI, you can take screenshots directly inside Obsidian and send them to AI instantly—no extra saving required. Temporary screenshots are used on the fly, fitting the natural habit of how screenshots are consumed.  

· **Struggling to share uncopyable PDFs, charts, or a specific video frame with AI?**  
  Screenshots are the perfect medium. With today’s Vision models handling most everyday needs, CaptureAI turns screenshots into a direct bridge to AI, making complex content flow seamlessly into conversations.  

· **Tired of constant copy & paste?**  
  CaptureAI’s “Magic Drag Zone” lets you simply drag text or images to send them to AI, reducing repetitive actions and fitting smoothly into your note-taking flow.  

· **Worried about losing valuable information from conversations, or want to continue later where you left off?**  
  CaptureAI is built on the idea of “Conversation-as-Notes.” AI responses can be inserted directly into the current note, saved as a standalone note, or reloaded anytime to restore full context—keeping conversations naturally continuous.  


## Features

### 📸 Advanced Screenshot Capture
- Region capture with intuitive selection tool
- In-preview editing: pen, highlighter, shape tools
- Direct edge dragging to adjust screenshot area without separate crop tool

### 🤖 AI Integration & Analysis
- Supports multiple AI models (OpenAI, Anthropic, Google, Custom)
- Automatically detects vision model capabilities and chooses intelligently
- Four modes: Analyze, OCR, Chat, Custom
- Supports image context-aware conversations
- System prompt customization for diverse scenarios
- Special styling and handling for thinking/reasoning blocks

### 💬 Enhanced Chat Interface
- Message block design with operation buttons
- Supports insert at cursor, copy, edit/read view toggle, delete
- Supports LaTeX and Markdown rendering
- Maintains context when switching models
- Session-to-note correspondence model

### 🖼️ Intelligent Image Management
- Multi-source image management:
  - From screenshots
  - Dragged from markdown files
  - Dragged from Vault images
  - Dragged from external file browser/web
  - Selected from file browser
- Supports Base64 temporary images without Vault storage
- Automatically saves images to configured locations when saving sessions
- Smart copy behavior with automatic path handling

### 📝 Smart Conversation Management
- Auto-save conversations with change detection
- Manual save with custom naming
- Tracks creation and modification timestamps
- Bidirectional synchronization between sessions and notes

---

## How It Works

1. **Capture**: Select any area on your screen with the region capture tool  
2. **Edit**: Annotate your screenshot using various drawing tools  
3. **Analyze**: Send it to AI with one of four modes  
4. **Converse**: Engage in intelligent dialogue based on image context  
5. **Organize**: Save conversations as notes or access them from history

---

## Installation

### From Obsidian Community Plugins (❌Coming Soon)
1. Open Obsidian  
2. Go to Settings > Community Plugins  
3. Disable "Safe Mode"  
4. Click "Browse" and search for CaptureAI  (The plugin is currently under review and not yet available in the community plugins)  
5. Click "Install"  
6. Enable the plugin after installation  

### Manual Installation✅
1. Download the latest release archive  
2. Extract into your Vault's `.obsidian/plugins/captureai` folder  
3. Restart Obsidian  
4. Enable CaptureAI in Settings > Community Plugins  

### Use BRAT Plugin To Add✅
1. Open Obsidian  
2. Go to Settings > Community Plugins  
3. Disable "Safe Mode"  
4. Click "Browse" and search for/install BRAT plugin  
5. In the BRAT settings panel, configure your GitHub Personal Access Token  
6. Choose "Add beta plugin" and add: do7and/obsidian-captureai

---

## Configuration

### AI Model Setup
1. Go to Settings > CaptureAI  
2. Configure API keys for AI services  
3. Manage and add models with vision capability  
4. Set default models for each operation mode

### Image Handling
- Configure screenshot save locations  
- Set temporary image size limits  
- Define other source image storage paths  
- Customize copy format

### UI Customization
- Adjust hotkeys  
- Configure display preferences  
- Set auto-save parameters

---

## Usage Examples

### Academic Research
- Capture textbook pages and extract text with OCR  
- Analyze charts for insights  
- Generate annotated study notes with AI assistance  

### Programming Assistance
- Capture code snippets for explanation and suggestions  
- Get UI design feedback  
- Document debugging sessions with visual references  

### Creative Work
- Annotate design mockups with feedback  
- Analyze visual content for creative inspiration  
- Organize visual ideas with AI tagging  

---

## Roadmap

- [ ] Bug fixes  

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository  
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)  
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)  
4. Push to the branch (`git push origin feature/AmazingFeature`)  
5. Open a Pull Request  

---

## Support

- 🐛 Report bugs on [GitHub Issues](https://github.com/Do7and/captureai/issues)  
- 💡 Suggest features on [GitHub Discussions](https://github.com/Do7and/captureai/discussions)  

---

## License

Copyright © 2025 Do7and

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).  
See the full license at [AGPL v3.0 License](https://www.gnu.org/licenses/agpl-3.0.en.html)

---

## Acknowledgments

- Thanks to the Obsidian team for creating an excellent knowledge management platform  
- Inspired by the intersection of AI and personal knowledge management  
- Icons from the Lucide Icons library

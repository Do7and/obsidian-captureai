# CaptureAI - Obsidian Plugin

<p align="center">
  <img src="captureai-logo.svg" width="120" height="120" alt="CaptureAI Logo" />
  <h3 align="center">Capture, Analyze, and Organize Visual Information with AI</h3>
</p>

[![GitHub release](https://img.shields.io/github/release/Do7and/captureai.svg)](https://github.com/Do7and/captureai/releases)
[![AGPL License 3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0.en.html)

---

**CaptureAI** is a powerful Obsidian plugin that supports screenshot capture and AI-powered analysis, transforming the way you interact with visual content and improving your knowledge management efficiency.

---

English | [简体中文](README.zh-CN.md) 

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

### From Obsidian Community Plugins (Coming Soon)
1. Open Obsidian  
2. Go to Settings > Community Plugins  
3. Disable "Safe Mode"  
4. Click "Browse" and search for CaptureAI  
5. Click "Install"  
6. Enable the plugin after installation  

### Manual Installation
1. Download the latest release archive  
2. Extract into your Vault's `.obsidian/plugins/captureai` folder  
3. Restart Obsidian  
4. Enable CaptureAI in Settings > Community Plugins  

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

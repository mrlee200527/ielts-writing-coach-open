<div align="center">

# IELTS Writing Coach

### 在写作过程中，得到恰到好处的帮助。

一个面向 IELTS Academic Writing 的本地运行 MVP。学生自己执笔，AI 在合适的时机提供少量、有依据的提示。

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs) ![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white) ![Status](https://img.shields.io/badge/status-stable%20MVP-7053D8)

</div>

---

## ✨ 它能做什么

| 写作阶段 | MVP 提供的帮助 |
| --- | --- |
| 开始前 | 输入 Task 1 或 Task 2 题目；Task 1 可上传题图并提取题目信息。 |
| 写作中 | 自动保存草稿；在句子完成后做轻量检查，避免反馈淹没写作过程。 |
| 提交后 | 根据作文与题目生成全文反馈，指出优先改进方向。 |

设计原则是**学生执笔、反馈克制、不确定性透明**。题图识别不确定时，系统不应把猜测当作批评学生的依据。AI 反馈仅供学习参考，不代表 IELTS 官方评分。

## 🗺️ 原型与项目背景

![最初版本的系统原型图](原型图/Version_1_总架构.png)

这是最初可用的 `stable-mvp-v1` 快照，适合阅读架构、在本机运行和继续实验。更多背景见 [产品需求](docs/PRODUCT_REQUIREMENTS_MVP.md)、[架构说明](docs/ARCHITECTURE.md)、[项目记忆](MEMORY.md) 和 [更新记录](CHANGELOG.md)。这些历史文档记录了当时的设计过程；实际运行方式以本 README 和代码为准。

## 🚀 本地运行

**环境：** Node.js 与 npm；项目使用 Next.js 16、React 19、SQLite 和 MiMo API。Windows 用户还可以自行构建可选的本地 Launcher。

```bash
npm ci
```

将 `.env.example` 复制为 `.env.local`，填入你自己的 MiMo API Key、控制台提供的 Base URL 和模型 ID：

```dotenv
MIMO_API_KEY=your_key_here
MIMO_BASE_URL=https://your-mimo-endpoint.example/v1
MIMO_MODEL=your-model-id
```

随后运行：

```bash
npm run dev:local
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。首次使用时，本地 SQLite 数据库会自动建立在 `.data/` 中。运行前请确认自己的 API 额度与费用；上传的题图和作文会发送到你配置的模型服务。

## 🧪 开发与验证

```bash
npm run typecheck
npm run test:unit
npm run build
```

端到端测试需要浏览器环境，可运行 `npm run test:e2e`。部分 AI 接口测试使用本地 fake 或可复现 fixture，不需要真实 API Key。

## 📦 公开副本的边界

本仓库从最初稳定 MVP 单独导出。个人 `.env.local`、本地数据、题库和从网上取得的题目图片均不在仓库中；原型图是项目自身的设计资料。官方评分标准 PDF、教师参考资料等第三方原件也未随代码发布。请使用你有权使用的题目与图片进行练习。

本项目目前是供学习与实验的早期版本，没有在线服务、账号系统或官方 IELTS 关联。

## 📄 许可证

本项目以 [MIT License](LICENSE) 发布。仓库未包含的第三方题目、图片及参考资料不在此许可范围内。

---

<div align="center">Made for thoughtful writing practice · 认真写，少打断</div>

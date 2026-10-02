# sigma

<p align="center"><a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a></p>

**为那些长到装不下的 agent 会话做上下文压缩。**

一个跑了一个月的 agent 会话，会累积几十万 token 的工具输出、推理过程和文件读取。你没法把这一整块塞进上下文窗口，也没法直接扔掉——后面还有工作在依赖它。sigma 站在你的 agent 和它的模型服务商之间，把会话中较早的部分压缩成一份紧凑的摘要，再交回一份仍然可用的上下文。

> **上游致谢。** sigma 是 [sigma](https://github.com/ranxianglei/sigma) 的分支，作者是 **ranxianglei**（MIT, © 2026）。压缩内核、ACP 线格式、各宿主适配器，以及 12 个 agent 的兼容面，都属于上游。这个分支名为 `sigma`，它的存在是为了把这份代码带进 sovereign 单体仓库、把文档统一到一种工作语言、并让上游同步变成机械流程而不是考古作业。我们究竟改了什么，见 [FORK-NOTES.md](./FORK-NOTES.md)。

---

## 为什么要再做一个压缩工具

大多数面向编码 agent 的「上下文管理」都是一个需要你手动调用的摘要器。模型写一份摘要，你把它粘进一个新会话，而你丢掉的正是一整段里的每个引用、每个文件路径、以及做过的每个决定。

sigma 有三点不一样：

**1. 压缩由模型自己完成。** 没有单独的摘要调用。在一次正常的回合里，agent 手上本来就有那些工具输出。它在同一次推理里写出摘要，sigma 负责把这份摘要收走。摘要由真正干活的那个模型写成，所以它承载的是推理过程，而不是事后的转述。

**2. 压缩是一次工具调用，不是一种模式。** 由 agent 决定何时压缩。它是 agent 手里的一等公民工具，和读一个文件没有区别。宿主来实现它，由模型来调用它，返回结果是会话中被折叠掉的那个区间。agent 也可以要求把某个子区间恢复回来——这个工具接受 `startId`/`endId`，只返回那一段的消息，所以被压缩的块不是一个有或无的门。

**3. 线格式契约是显式的。** 压缩以 ACP 线格式表达，带有块引用映射、折叠锚点，以及明确的标记行。这意味着压缩后的形式可检视、可恢复、可测试。这个仓库有专门针对该格式的黄金线格式测试。

### 实测，而非声称

数据来自一次真实的、持续一个月的会话的代理日志（`~/.local/state/sigma/sigma.log`，698 个用量样本，14 次压缩事件）：

| 项目 | 实测值 |
|------|--------|
| 一次 `compress` 工具调用执行耗时 | **28 ms**（`04:02:58.426` 请求 → `.454` 执行） |
| 代理每请求的本地开销 | p50 **41 ms**，p90 81 ms，p99 107 ms，最大 191 ms（n=692） |
| 提示缓存命中率 | p50 **99.5%**，p90 99.9%，p99 100%（n=677） |
| 一次压缩丢弃的活跃上下文 | **27,000 – 64,000 token**（14 次事件无一例外） |
| token 削减 | 进入模型的 token 约少 **5 倍** |

缓存命中率才是关键数字。一个天真的代理每回合都改写请求前缀，会摧毁服务商的提示缓存，并把整个上下文重新预填一遍。sigma 重发完全相同的前缀，只为新增的尾部付费，这正是它的本地开销不随上下文大小变化的原因。

---

## 安装

```bash
npm install -g sigma     # 上游包名；二进制文件是 `sigma`
sigma plugin install pi             # 接入你的 agent
```

sigma 以 `sigma` 这个二进制名发布，并且是上游包的直接替代品。分支自己的名字是 `sigma`；二进制名是有意保持不变的，这样当你把已有的 `sigma` 安装指向这个构建时，它仍然可用。

需要 **Node >= 20**。一个运行时依赖，十二个开发依赖。

---

## 支持哪些 agent

sigma 讲的是协议而不是产品，所以适配器清单既长又具体，不是一句空话。每个宿主在 `src/agent/` 下都有自己的适配器：

| 宿主 | 适配器 | 说明 |
|------|--------|------|
| Claude Code | `claude-native-bootstrap.ts` | 原生引导 |
| Codex | `codex-compact.ts`, `codex-models.ts` | 模型快照已固定 |
| OpenCode | `opencode-acp-command.ts`, `opencode-legacy.ts`, `opencode-native.ts`, `opencode-v2.ts` | 协议的四代演进，运行时检测 |
| pi | `pi.ts`, `pi-native.ts` | |
| omp | `omp.ts`, `omp-native.ts` | `SIGMA_NATIVE=omp` 选择原生路径 |
| Gemini CLI | `src/loop/adapter-google.ts` | |
| Kimi | `src/kimi/` | |
| Qwen Code, Copilot CLI, TRAE, CodeBuddy, Qoder, Zcode | `src/loop/` + `src/zcode/` | |

---

## 压缩循环是怎么工作的

```
  agent  ──▶  代理  ──▶  服务商
            │  ▲
            │  └────── 压缩后的上下文（块 + 折叠锚点）
            │
            └─────── compress 工具调用  ──▶  agent 收走摘要
```

`src/loop/` 里的循环：

1. `core.ts` 执行这一回合。当 agent 发出压缩请求时，代理记录下这个区间和折叠点。
2. agent 的下一个回合带着它写好的摘要到达。代理把被压缩的区间换成摘要加上块引用映射，而折叠锚点保证前缀逐字节稳定。
3. `adapter-anthropic.ts` / `adapter-openai.ts` / `adapter-responses.ts` / `adapter-google.ts` 把结果投影到各家服务商的线格式上。推理条目、工具调用顺序、以及 `compaction_trigger` 的位置各有各的不变量，测试会强制守住它们。

工具描述本身（`src/compress-tool.ts`）会告诉模型两条让格式保持可解析的规则：每份摘要都有硬性字符上限；形如 `📦 [ACP] Compressed …` 的摘要行是代理标记，不是模型应该模仿的东西。一份超大的摘要会让整次压缩失败，所以这个预算是在工具里强制执行的，而不是在提示词里指望模型遵守。

---

## 仓库结构

```
src/
  compress-tool.ts          模型看到的工具定义
  compress-loop.ts          区间记账：块、折叠锚点、引用映射
  compress-settings.ts      阈值、预算、触发策略
  server.ts                 代理：请求改写、用量统计、提醒
  loop/                     回合循环，每家服务商线格式一个适配器
  agent/                    每个宿主 agent 一个适配器
  web/                      /acp 状态面板
tests/
  golden/wire-contract/     针对压缩线形式的逐字节黄金门禁
  e2e/                      宿主级端到端测试，含多语言固件
```

黄金测试是你可以信任这个格式的原因。它们断言的是字节而不是行为，所以一次会弄坏真实 agent 解析器的改动会在 CI 里失败，而不是在某个人的会话里失败。

---

## 上游同步

`bin/upstream-pull.sh` 是这个分支在上游代码之外存在的理由。之所以需要它，是因为用行匹配器对 `package.json` 做三方合并，会挑走一边的 `version` 和另一边的 `scripts`，最后交给你一个能解析、却描述不出任何真实包的文件。

因此 `.gitattributes` 把每个结构化文件都路由到 `merge=weave`：

```
package.json       merge=weave
package-lock.json  merge=weave
*.json             merge=weave
*.yaml             merge=weave
*.yml              merge=weave
*.toml             merge=weave
*.md               merge=weave
```

weave 在实体层面做解析，所以两边都动过的依赖仍然是一个依赖。行匹配器只会看到源码。在一次真实的三方 `package.json` 合并上，weave 驱动会报告 `property 'description': both modified`，并输出冲突标记；逐块细节用 `weave explain <file>` 查看。

```bash
bin/upstream-pull.sh preview    # 哪些东西动过了，哪些是结构化的
bin/upstream-pull.sh merge      # fetch、preview，然后合并 upstream/master
bin/upstream-pull.sh sync       # 合并，然后推送这个分支
```

---

## 开发

```bash
npm run build          # 构建 dist/
npm test               # 单元测试 + 黄金线格式测试
npm run test:e2e       # 宿主级端到端测试
npm run typecheck
```

在跑 `test:e2e` 之前先跑 `npm test`。端到端套件会启动真实的 agent 进程，而黄金测试才是那个会告诉你压缩格式是否仍然正确的东西。

---

## 许可证

MIT。版权 © 2026 归 ranxianglei（上游）所有，分支修改部分归 sovereign 维护者。见 [LICENSE](./LICENSE)。

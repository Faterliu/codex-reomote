# 手机端处理 Codex 计划模式询问：最小改动方案

## 结论

当前问题不是 Cloudflare、SSH 或 Relay 链路故障。手机端与电脑端正在使用不同的 Codex App Server 写入者：当任务由电脑端启动并进入计划模式的用户询问时，询问请求发给了电脑端连接，手机端只看到线程仍处于活动状态。此时从手机发送普通消息会触发：

```text
already has an active writer
```

`app-codexapp` 当前源码已经能处理 `item/tool/requestUserInput`：接收请求、显示问题卡片，并按原请求 ID 提交回答。它不能可靠接管由另一个 App Server 进程持有的进行中电脑端任务。

## 方案比较

| 方案 | 改动量 | 能否回答电脑端已启动任务的计划询问 | 说明 |
| --- | --- | --- | --- |
| 统一从手机端启动可能需要追问的任务 | 无 | 可以 | 询问会发给手机持有的连接。 |
| 使用官方 Codex Remote | 无代码改动 | 可以 | 推荐；官方功能可从手机继续任务、提供输入和审批。 |
| 增加“外部写入者”提示 | 很小 | 不可以 | 消除误解，避免反复发送导致 `active writer` 错误。 |
| 电脑 CLI 与手机共用同一个 App Server | 较小 | 需要联调验证 | 保留自制手机端，但电脑要使用 CLI 远程界面。 |
| 保留桌面 GUI 并由自制手机端接管 | 较大 | 可以 | 需要为未决请求实现跨客户端转发与回答路由。 |

## 推荐路径

### 最小总体改动：使用官方 Codex Remote

如果目标是让手机可靠地回答电脑端任务的询问，最小总体改动是使用官方 Remote，而不是继续扩展自制隧道。

在 Windows 的 ChatGPT 桌面应用中进入：

```text
设置 → 连接 → 控制此 Mac 或 PC → 设置 / 添加
```

随后用同一 ChatGPT 账户的手机应用扫描二维码，在手机的“远程”页面选择该电脑。官方 Remote 支持继续现有任务、提供输入、审批操作和查看结果。

参考：

- [Codex Remote](https://learn.chatgpt.com/zh-Hans/docs/remote)
- [远程连接](https://learn.chatgpt.com/zh-Hans/docs/remote-connections)

### 最小源码补丁：明确提示并阻止误发送

这个补丁不能把电脑端的询问内容带到手机，但能避免用户误以为网络故障，并提供正确的恢复路径。

修改范围预计为 2～3 个文件、30～60 行：

1. 在 `apps/mobile/src/hooks/useCodexAppServer.ts` 检测：

   ```ts
   selectedThread?.status.activeFlags.includes("waitingOnUserInput")
   && !userInputRequest
   ```

   将状态标记为“其他客户端持有的用户输入请求”。

2. 在 `apps/mobile/src/components/ThreadDetail.tsx` 显示说明卡片：

   ```text
   此任务正在电脑端等待回答。
   手机没有收到原始问题，不能用普通消息替代回答。
   请在电脑端回答、停止该回合，或尝试重新获取询问。
   ```

3. 禁用普通发送按钮，并提供“重新获取询问”按钮。该按钮强制执行 `thread/resume`；它可帮助同一 App Server 的断线重连场景恢复未决请求，但无法接管另一个 App Server 进程的写入者。

现有的 `item/tool/requestUserInput` 接收与回答逻辑不需要重写：

- `apps/mobile/src/lib/jsonRpcClient.ts`
- `apps/mobile/src/components/user-input/UserInputRequestCard.tsx`

## 保留自制手机端的最小功能性调整

如果必须保留自制手机端，并且愿意改用 Codex CLI 作为电脑端界面，可以让电脑和手机共用已启动的 App Server：

```text
同一个 codex app-server（127.0.0.1:4500）
├─ 电脑端：codex --remote ws://127.0.0.1:4500
└─ 手机端：Relay → SSH 反向隧道 → Cloudflare Quick Tunnel
```

这样不会再由两个独立 App Server 竞争同一线程的写入权。手机端已有的强制 `thread/resume` 恢复逻辑可尝试重新附加到活动线程并接收未决请求，但需要用真实设备验证。

注意：这个方案不保留 Codex Desktop App 的原生 GUI；官方文档说明 `codex --remote` 可以连接到 App Server 的 WebSocket 监听器。

## 不建议的“伪修复”

- 不要把计划模式的回答当作普通聊天消息发送；这不会完成原始 `requestUserInput` 请求。
- 不要自动选择“推荐”选项。协议虽支持 `autoResolutionMs`，但自动回答可能改变任务方向或触发不符合预期的操作。
- 不要通过重启 Cloudflare、SSH 或 Relay 来解决 `active writer`；它们与写入权冲突无关。

## 协议依据

Codex App Server 将用户输入作为服务端主动发起的 `item/tool/requestUserInput` JSON-RPC 请求；客户端需要对该请求作答。请求在回合启动、完成或中断时会被清理。App Server 也支持 `turn/interrupt` 中断当前回合。

参考：[Codex App Server](https://developers.openai.com/codex/app-server)

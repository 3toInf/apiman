# apiman

本地 API 测试工作台，面向从 Talend API Tester 迁移到 Firefox / Zen 的使用者。TypeScript、React、WXT，Chrome 和 Firefox 均使用 Manifest V3。界面沿用仓库树、请求、响应、断言和场景的工作方式；这是独立实现，与 Talend / Qlik 无关联。

## 安装

需要 Node.js 24 和 npm：

```sh
npm ci
npm run build
npm run zip
```

- **Chrome / Chromium**：打开 `chrome://extensions`，启用开发者模式，选择「加载已解压的扩展程序」，目录为 `.output/chrome-mv3`。
- **Firefox / Zen**：打开 `about:debugging#/runtime/this-firefox`，选择「临时载入附加组件」，打开 `.output/firefox-mv3/manifest.json`。临时安装在浏览器重启后失效；长期安装需要 Mozilla 签名。本仓库产物未签名、未发布到商店。
- 点击工具栏中的 apiman 图标打开独立工作台。首次发送请求时，允许目标站点权限。场景可能动态引用不同主机，因此首次运行会申请 HTTP / HTTPS 站点权限。

最低版本：Chrome 120、Firefox 140。自动化验收使用 Chromium 和 Firefox；Zen 基于 Firefox，但未在 Zen 客户端单独实测。

## 日常使用

1. **New request** 创建请求，选择方法，填写完整 URL。Headers 和 Body 支持变量表达式；Query 单独管理启用状态和重复参数。
2. **Environments** 管理环境变量，顶部切换环境。`${"baseUrl"}/users` 会替换当前环境变量；Private 值在编辑器隐藏，默认备份清空。
3. **Send** 发送，第二次点击取消。响应可查看 Pretty / Raw / Preview、Headers 和实际请求摘要，支持搜索、下载。HTML 预览隔离脚本、网络和导航；链接、表单生成待发送的新草稿。
4. **Assertions** 支持状态、响应头、正文、大小、时间、JSONPath 和 XPath。编辑条件会基于当前完整响应重新计算。
5. 建立 Project / Service / Scenario 管理请求。场景按明确步骤执行，可重复、延迟、失败停止；项目和服务按名称顺序批量运行。
6. `Ctrl/Cmd+S` 保存，`Ctrl/Cmd+Enter` 发送。草稿和标签页恢复；History 可重放为草稿。

认证支持 Basic、Bearer、API Key。正文支持 JSON、XML、文本、URL 编码表单、multipart 文件和二进制文件。文件存储在本机 IndexedDB。

## Talend 迁移与备份

在 Talend 中导出 API Tester repository JSON，再在 apiman 点 **Import → Choose file → Preview import → Import data**。预览显示数量和兼容性说明，导入追加到当前仓库，不覆盖已有项目。

- 主要适配 **Talend JSON version 6**：项目、服务、场景步骤、请求、环境变量、启用状态、断言、表达式及请求间引用。测试夹具来源见 [tests/fixtures/README.md](tests/fixtures/README.md)。
- 已绑定的请求引用按 ID 跟踪；重命名或导入同名项目后继续指向原依赖。手工输入有歧义的引用会报错，需要明确项目路径。
- 未支持的执行配置会列出并阻止发送。只有确认配置后，才使用 **Discard unsupported settings**；完整备份保留原请求源数据。
- 也可导入 Postman v2、OpenAPI / Swagger、HAR 1.2 和常用 cURL。OpenAPI 生成请求样例，需填写参数、认证并核对兼容性说明；不会执行 Postman 脚本或 shell 命令。
- **Export** 生成跨浏览器可导入的 apiman 原生 JSON，可选择项目、包含私密值、包含上传文件。默认不包含私密值和文件。此格式不承诺回写 Talend。

表达式例子：

```text
${"token"}
${"Login"."response"."body".jsonPath("$.token")}
${"Project"."Login"."response"."headers"."Content-Type"}
${"text".base64()}
${"7".math("MULTIPLY", "6")}
${timestamp().formatDate("TIMESTAMP", "ISO_8601")}
```

表达式使用受限解释器，支持字符串、编码、散列/HMAC、数学、日期和随机函数。响应引用限当前会话已有响应；每次场景迭代使用独立响应上下文。未支持的函数返回明确错误，不执行 JavaScript。

## 数据与浏览器边界

全部工作区数据存在当前浏览器的 IndexedDB；无账户、同步服务、遥测或原生助手。网络流量来自用户发送的请求。私密变量保存在本地，**未加密**。备份应妥善保管；卸载扩展或清理扩展数据前先导出。

历史最多 500 条，历史正文预览最多 1 MiB；保留最近 30 份场景报告，每步正文最多 64 KiB。默认响应限制 20 MiB，可在请求设置修改；单次场景最多 1000 步。截断结果不用于重新计算断言。历史和报告会遮蔽已知凭据及私密变量，但不会自动识别响应中所有业务敏感数据。

HTTP 请求在完整工作台页面执行，避免依赖后台 service worker 的生命周期；关闭或刷新工作台会终止运行，重开后报告标记为中断，不自动重发。

受浏览器限制：遵守证书信任、Cookie 策略、重定向与受控请求头限制，不能伪造 Cookie / Host / Origin / User-Agent，也不支持 GET/HEAD 请求体。无 TLS 校验绕过、交互式 OAuth 登录向导、WebSocket、gRPC 或任意用户脚本。

## 开发与验证

```sh
npm run dev                 # Chrome
npm run dev:firefox         # Firefox
npm run check               # 类型、ESLint、单元/集成测试、双浏览器构建、web-ext lint
npx playwright install --with-deps chromium firefox
npm run test:e2e            # 实际安装两个扩展，连接本地 HTTP 测试服务
npm run format:check
npm audit --omit=dev
```

E2E 需要 Python 3（创建临时 XPI），Selenium/geckodriver 和 Playwright Firefox；可用 `FIREFOX_BIN` 指定非 Snap Firefox。测试只访问 loopback 回声服务，在一次性扩展副本中预授予主机权限，避免原生授权弹窗，因此不自动验证权限弹窗交互。生产 manifest 保留可选主机权限。

`web-ext` 检查允许三处已审查的 `innerHTML` 提示：React DOM 的两处内部实现，以及 `core/html.ts` 在未连接文档的 `<template>` 中解析 HTML 后按白名单清理的实现。其他警告和所有错误均失败。测试覆盖预览不执行脚本或发起资源请求。

代码边界：`src/core` 请求/表达式/断言/执行器，`src/importers` 格式适配，`src/storage` 本地持久化，`src/ui` 工作台。构建产物在 `.output`，测试截图在 `test-results`，实现与审查记录见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。

断言比较遵循 Talend 的类型语义：数字按数值比较，普通字符串按长度比较；JSON 断言保留数组/对象类型。[Talend 断言操作符说明](https://help.qlik.com/talend/en-US/api-tester-user-guide/Cloud/assertion-operators)。

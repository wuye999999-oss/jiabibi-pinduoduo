# 真实授权验价模式 (Authorized Sandbox Price Verification)

## 功能说明

真实授权验价模式允许用户在价比比中开启一次性临时浏览器会话，通过自行登录各平台，读取真实搜索页面上的公开价格信息，从而获得更贴近真实购买场景的比价数据。

与普通 API 比价结果不同，授权验价数据直接来自平台页面，标记为 `source=sandbox`，可与 API 数据合并参与三类价格比较。

## 用户授权流程

1. 用户在搜索结果页点击「开启真实授权验价」
2. 确认授权提示弹窗（阅读安全边界说明）
3. 点击「我知道了，开始验价」
4. 系统为每个平台创建独立的临时浏览器会话
5. 用户在截图预览区域看到各平台当前页面状态
6. 如果平台提示需要登录/扫码，用户手动完成验证（价比比不会绕过或代替用户操作）
7. 登录完成后点击「开始搜索」
8. 系统在每个平台浏览器中搜索商品，读取结果
9. 结果合并进三类价格（官方/自营最低价、渠道店最低价、普通店最低价）
10. 搜索结束后自动销毁会话，或用户随时点「结束授权验价」

## 安全边界

**我们不做以下事情：**

- 不收集账号密码（页面没有账号密码输入框）
- 不长期保存 Cookie 或 localStorage
- 不保存订单、地址、手机号、实名信息
- 不读取购物车、订单页
- 不自动下单、不自动领券
- 不绕过验证码或滑块（遇到时提示用户手动处理）
- 不做指纹伪装、不使用代理池
- 不批量爬取平台数据
- 不将一个用户的会话用于其他用户
- 不将 Cookie/token/set-cookie 写入日志
- 不将 App Secret 写入 GitHub
- 所有临时会话有 TTL，到期自动销毁
- 用户随时可以点「结束授权验价」，后端立即关闭浏览器并删除临时目录

**遇到验证码时只提示用户手动处理**，因为：
1. 绕过验证码违反平台使用条款
2. 验证码存在的目的是防止自动化，尊重平台规则是价比比的基本原则
3. 用户自己手动处理更安全，平台账号不会被风控

## API 列表

所有 sandbox API 需要后端设置 `SANDBOX_ENABLED=true`。

### POST /api/sandbox/session
创建一次性真实授权验价会话。

```json
// 请求
{ "platforms": ["jd", "pdd", "taobao", "douyin"], "keyword": "百岁山 570ml 24瓶" }

// 响应
{ "ok": true, "sessionId": "...", "expiresAt": "...", "keyword": "...", "platforms": { "jd": { "status": "created" }, ... } }
```

### GET /api/sandbox/session/:sessionId/status
查询会话状态。状态值：`created | opening | need_user_login | need_user_action | searching | extracting | success | failed | expired | closed`

### GET /api/sandbox/session/:sessionId/screenshot?platform=jd
返回当前平台的浏览器截图（JPEG）。不保存到长期存储，每次实时生成。

### POST /api/sandbox/session/:sessionId/action
允许用户对临时浏览器进行必要的手动操作（点击、输入、滚动、导航）。

```json
{ "platform": "jd", "type": "click", "x": 100, "y": 200 }
{ "platform": "jd", "type": "type", "text": "百岁山" }
{ "platform": "jd", "type": "press", "key": "Enter" }
{ "platform": "jd", "type": "scroll", "deltaY": 300 }
{ "platform": "jd", "type": "navigate", "url": "https://search.jd.com/Search?keyword=test" }
```

navigate 类型只允许访问各平台的官方域名（白名单）。

### POST /api/sandbox/session/:sessionId/search
在指定平台执行真实搜索并返回结果。

```json
// 请求
{ "keyword": "百岁山 570ml 24瓶", "platforms": ["jd", "pdd"] }

// 响应
{ "ok": true, "sessionId": "...", "keyword": "...", "total": 15, "platforms": { ... }, "results": [ { "source": "sandbox", ... } ] }
```

### GET /api/sandbox/session/:sessionId/results
读取当前会话的全部验价结果。

### DELETE /api/sandbox/session/:sessionId
关闭会话，立即销毁浏览器，删除临时 userDataDir。

## 统一结果结构

每条 sandbox 商品的结构：

```json
{
  "source": "sandbox",
  "provider": "jd",
  "title": "百岁山 饮用天然矿泉水 570ml*24瓶",
  "price": 68.00,
  "originalPrice": null,
  "shopName": "京东自营",
  "shopType": "self_operated",
  "brand": "",
  "specText": "",
  "itemUrl": "https://item.jd.com/...",
  "imageUrl": "https://...",
  "confidence": 0.85,
  "sameProductScore": 0,
  "warnings": [],
  "rawVisibleText": "..."
}
```

`shopType` 取值：`self_operated | official | flagship | channel | normal | unknown`

## 环境变量

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `SANDBOX_ENABLED` | `false` | 设为 `true` 开启授权验价模式 |
| `SANDBOX_SESSION_TTL_MS` | `600000` | 会话 TTL（毫秒），默认 10 分钟 |
| `SANDBOX_MAX_CONCURRENT` | `2` | 最大并发会话数 |
| `SANDBOX_HEADLESS` | `true` | 是否无头浏览器，本地调试可设为 `false` |
| `SANDBOX_ALLOWED_PLATFORMS` | `jd,pdd,taobao,douyin` | 允许的平台 |

## Render 部署方法

1. 在 Render dashboard 的 Environment 页面添加环境变量：
   - `SANDBOX_ENABLED=true`
   - `SANDBOX_MAX_CONCURRENT=2`（Render 免费实例内存有限，建议不超过 2）
   - `SANDBOX_SESSION_TTL_MS=600000`

2. 修改 Build Command 为：
   ```
   npm install && npx playwright install --with-deps chromium
   ```
   （Render 构建时会安装 Chromium 及所有系统依赖）

3. Start Command 保持不变：`npm start`

4. 注意：Render 免费实例 RAM 512MB，每个 Chromium 实例约用 150-200MB，MAX_CONCURRENT=2 是安全上限。

## 本地运行方法

```bash
# 安装依赖
npm install

# 安装 Playwright 和 Chromium
npm run playwright:install
# 或者: npx playwright install --with-deps chromium

# 设置环境变量
export SANDBOX_ENABLED=true
export SANDBOX_HEADLESS=false  # 本地调试时可看到浏览器窗口
export SANDBOX_MAX_CONCURRENT=2

# 启动
npm start

# 运行测试（不需要 Playwright）
npm test
```

## 常见失败原因

| 状态 | 原因 | 处理方式 |
|---|---|---|
| `need_user_login` | 平台检测到未登录，自动跳转登录页 | 用户在截图中扫码或输入凭据登录 |
| `need_user_action` | 遇到验证码、滑块、二次验证 | 用户手动在截图中完成验证 |
| `failed` / `navigation_timeout` | 平台页面加载超时 | 重试或改用 API 数据 |
| `failed` / `no_items_extracted` | 页面结构变化，选择器未匹配 | 提交 issue 更新适配器 |
| `douyin_web_shopping_requires_app_or_login` | 抖音商城在 Web 端需要 App 验证 | 提示用户此平台仅支持 API 数据 |
| `playwright_not_installed` | 未安装 Playwright | 运行 `npm run playwright:install` |

## 为什么不保存账号密码 / Cookie

1. **隐私**：账号密码和 Cookie 包含用户对平台的完整访问权限，价比比不需要也不应该保存
2. **安全**：如果价比比服务器被攻击，不保存意味着没有泄露风险
3. **合规**：平台的使用条款明确禁止第三方长期持有用户凭据
4. **信任**：价比比的核心价值是帮用户比价，而不是管理用户账户

每次验价会话结束后，所有临时数据（浏览器进程、用户数据目录）都会被立即销毁。

## 为什么遇到验证码只提示用户手动处理

1. **平台规则**：绕过验证码违反各平台的使用条款（服务协议、robots.txt）
2. **账号安全**：自动绕过验证码可能触发平台的风控机制，导致用户账号被封
3. **技术诚实**：验证码是平台保护自身的合法手段，我们尊重这一机制
4. **设计边界**：价比比是比价工具，不是爬虫框架

# 价比比 Jiabibi MVP

这是当前已跑通的拼多多单平台 MVP 项目结构。

## 目录结构

```text
jiabibi/
├─ api/      后端：对接拼多多开放平台 API
├─ web/      前端：搜索、商品卡片、收藏、历史、跳转购买
└─ README.md
```

## 已完成能力

- 拼多多商品搜索：`pdd.ddk.goods.search`
- PID 授权备案
- 商品推广链接生成：`pdd.ddk.goods.promotion.url.generate`
- 本地后端接口
- 前端 App 感页面
- 搜索历史、本地收藏、商品卡片、去购买跳转

## 第一次启动

### 1. 启动后端

进入 `api` 文件夹，双击：

```text
start.bat
```

第一次运行会自动创建 `.env`，然后退出。

打开 `api/.env`，填写：

```env
PDD_CLIENT_ID=你的client_id
PDD_CLIENT_SECRET=你的client_secret，不要发给任何人
PDD_PID=你的PID
PORT=3000
```

保存后，再双击：

```text
api/start.bat
```

看到下面这类提示就代表后端启动成功：

```text
Jiabibi API running: http://localhost:3000
```

浏览器测试：

```text
http://localhost:3000/api/pdd/search?keyword=充电宝
```

### 2. 启动前端

保持后端黑窗口不要关。

进入 `web` 文件夹，双击：

```text
start-web.bat
```

网页打开后可以搜索商品、收藏、查看历史、点击“去购买”。

## 后端接口

### 搜索商品

```text
GET /api/pdd/search?keyword=充电宝
```

返回字段包括：

```text
goods_name
image
min_group_price
coupon_discount
final_price
sales_tip
goods_sign
tags
```

### 生成购买链接

```text
POST /api/pdd/link
Content-Type: application/json

{
  "goods_sign": "商品goods_sign"
}
```

返回字段包括：

```text
mobile_short_url
short_url
mobile_url
url
schema_url
we_app_info
```

## 安全提醒

- `PDD_CLIENT_SECRET` 只能放在 `api/.env`，不要放进前端。
- 不要把 `.env` 上传 GitHub。
- 如果密钥发到聊天、截图、群里，立刻去开放平台重置。
- 正式部署时，把服务器公网 IP 加入拼多多开放平台 IP 白名单。

## 下一步建议

1. 上传 GitHub 前确认 `.env` 不在仓库里。
2. 部署后端到云服务器。
3. 前端部署到静态站点。
4. 拼多多跑稳定后，再接淘宝联盟、京东联盟。

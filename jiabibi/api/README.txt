价比比 PDD 后端测试包

1. 双击 start.bat
2. 第一次会自动创建 .env，然后退出
3. 用记事本打开 .env，填写：
   PDD_CLIENT_ID=你的client_id
   PDD_CLIENT_SECRET=你的client_secret
   PDD_PID=你的PID
   PORT=3000
4. 保存 .env
5. 再双击 start.bat
6. 浏览器打开：http://localhost:3000/api/pdd/search?keyword=充电宝

生成推广链接：
- 保持 start.bat 黑窗口运行
- 双击 test-link.bat
- 粘贴 goods_sign

前端接口：
GET  /api/pdd/search?keyword=充电宝
POST /api/pdd/link body: {"goods_sign":"..."}

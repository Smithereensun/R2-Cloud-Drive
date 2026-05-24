# R2 Cloud Drive ☁️

基于 Cloudflare Workers + R2 的免费云端硬盘，采用 Google Material Design 风格。

[![Telegram](https://img.shields.io/badge/Telegram-@HandsomMJZ-blue?logo=telegram)](https://t.me/HandsomMJZ)

![截图](https://cloud.junzhen.qzz.io/api/download?path=shared%2F2.png)

## 功能特性

- 📁 **文件管理**：上传、下载、删除、重命名、新建文件夹
- 🔄 **两种视图**：网格视图 / 列表视图，支持排序
- ✂️ **复制/剪切/粘贴**：通过 KV 持久化剪贴板，跨页面导航不丢失
- 🔗 **共享文件夹**：`/shared` 路径公开只读共享，无需登录即可下载
- 📦 **大文件分片上传**：网页端自动使用 R2 Multipart Upload，突破单次请求大小限制
- 🌐 **多账号存储节点**：主控 Worker 可添加多个节点账号，大文件分片均摊存储，并通过 manifest 索引下载
- 🧩 **WebDAV 支持**：`/dav` 路径可挂载到支持 WebDAV 的客户端
- 🌙 **夜间模式**：深色主题切换，自动记住偏好
- 📊 **容量显示**：默认显示总容量使用情况，点击后展开每个节点的容量明细（每个账号/节点默认 10 GB）
- 🖱️ **右键菜单**：文件/文件夹右键快捷操作
- 🎯 **单击选中，双击操作**：单击选中文件，双击下载/进入文件夹
- 📤 **拖拽上传**：支持拖拽文件上传，显示上传进度

## 部署教程

### 前置条件

- [Cloudflare](https://dash.cloudflare.com/) 账号
- [PayPal]你的cloudflare账号必须绑定PayPal,否则无法创建R2存储桶

### 步骤 1：创建 R2 存储桶

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单进入 **R2 Object Storage**
3. 点击 **Create bucket**
4. 输入存储桶名称，例如 `my-cloud-drive`
5. 点击 **Create bucket**

### 步骤 2：创建 KV 命名空间

1. 左侧菜单进入 **Workers & Pages**
2. 点击 **KV** 标签页
3. 点击 **创建命名空间**
4. 输入自定义名称(自己记住就行了)
5. 点击 **创建**

### 步骤 3：创建 Worker 并粘贴代码

1. 左侧菜单进入 **Workers & Pages**
2. 点击 **Create application** 或 **Create**
3. 选择 **Worker**
4. 输入 Worker 名称，例如 `r2-cloud-drive`
5. 创建后进入 Worker 的在线编辑器
6. 删除默认示例代码，把本项目的 `worker.js` 全部内容粘贴进去
7. 点击 **Deploy** 保存部署

### 步骤 4：绑定 R2 和 KV

进入刚创建的 Worker 后，按下面方式添加绑定：

1. 打开 **Settings**
2. 进入 **Bindings**
3. 点击 **Add binding**
4. 选择 **R2 bucket**
5. Variable name 填写 `R2_BUCKET`
6. R2 bucket 选择步骤 1 创建的存储桶
7. 保存
8. 再次点击 **Add binding**
9. 选择 **KV namespace**
10. Variable name 填写 `CLIPBOARD_KV`
11. KV namespace 选择步骤 2 创建的命名空间
12. 保存并点击 **Deploy**

> 注意：绑定名称必须完全一致，代码里使用的是 `env.R2_BUCKET` 和 `env.CLIPBOARD_KV`。

### 步骤 5：设置变量和密钥（可选）

| 变量名 | 说明 | 是否必须 | 默认值 |
|--------|------|---------|--------|
| `ACCESS_PASSWORD` | 访问密码，不设置则为公开访问 | 可选 | 无 |
| `SITE_TITLE` | 站点标题 | 可选 | `R2 云盘` |
| `CLOUD_ICON_URL` | 云盘图标图片链接 | 可选 | 橙色圆角云朵图标 |
| `LOGIN_BACKGROUND_URL` | 登录页背景图片链接 | 可选 | 淡灰色背景 |
| `STORAGE_NODE_TOKEN` | 存储节点密钥，节点 Worker 用于接收主控上传分片 | 可选 | 无 |

设置方法：

1. 进入 Worker 的 **Settings**
2. 打开 **Variables and Secrets**
3. 点击 **Add**
4. 选择变量类型：
   - `ACCESS_PASSWORD` 建议选择 **Secret**
   - `STORAGE_NODE_TOKEN` 建议选择 **Secret**
   - `SITE_TITLE`、`CLOUD_ICON_URL`、`LOGIN_BACKGROUND_URL` 可选择普通文本变量
5. 填写变量名和值
6. 点击 **Save**
7. 点击 **Deploy** 让配置生效

### 步骤 6：访问 Worker

部署成功后，在 Worker 页面可以看到一个 `https://你的项目名.你的账号.workers.dev` 地址，打开即可访问云盘。

### 步骤 7：自定义域名（可选）

在 Cloudflare Dashboard → Workers & Pages → 你的项目 → Triggers → Custom Domains 中添加你的域名。

## 使用说明

### 管理员操作

1. 访问你的 Worker 地址
2. 如果设置了密码，输入密码登录
3. 进入主界面后可以：

| 操作 | 方式 |
|------|------|
| 上传文件 | 点击「上传」按钮或拖拽文件到页面 |
| 新建文件夹 | 点击「新建文件夹」 |
| 选中文件/文件夹 | 单击（蓝色高亮） |
| 下载文件 | 双击文件，或选中后点击操作栏「下载」 |
| 进入文件夹 | 双击文件夹 |
| 复制文件 | 选中 → 点击「复制」→ 进入目标文件夹 → 点击「粘贴」 |
| 剪切文件 | 选中 → 点击「剪切」→ 进入目标文件夹 → 点击「粘贴」 |
| 重命名 | 选中单个文件/文件夹 → 点击「重命名」 |
| 删除 | 选中 → 点击「删除」 |
| 切换视图 | 点击工具栏的网格/列表切换按钮 |
| 夜间模式 | 点击顶部的月亮/太阳图标 |

### 大文件上传

网页端上传大于约 90 MiB 的文件时会自动切换为分片上传。

如果没有配置存储节点，大文件会使用当前账号的 R2 Multipart Upload；如果配置了存储节点，大文件会按分片均摊上传到多个节点账号，主控 R2 只保存 manifest 索引。

Cloudflare Free/Pro 的单次请求体限制为 100 MB，因此每个分片会控制在限制以内；分布式上传和 R2 Multipart Upload 都最多支持 10,000 个 part。

### 多账号存储节点

多账号容量合并采用“主控 Worker + 多个存储节点 + manifest 索引”：

1. 主控 Worker 负责登录、文件列表、manifest 索引、下载拼接。
2. 存储节点 Worker 负责保存大文件分片。
3. 大文件上传时，浏览器把每个分片直接上传到不同节点。
4. 上传完成后，主控在当前 R2 写入一个 manifest 文件，记录每个分片的位置。
5. 下载时主控按 manifest 顺序读取节点分片并拼接返回。

添加节点步骤：

1. 在另一个 Cloudflare 账号中按同样方法部署本项目 Worker，并绑定该账号自己的 R2 存储桶。
2. 在该节点 Worker 的 **Variables and Secrets** 中添加 `STORAGE_NODE_TOKEN`，值自定义为一串足够长的密钥。
3. 回到主控 Worker 页面，点击顶部或侧边栏的「存储节点」按钮。
4. 填写节点名称、节点 Worker 地址、节点密钥和权重。
5. 点击「添加节点」后，节点配置会保存到主控的 KV 中。

权重用于分片分配，例如两个节点权重分别为 `2` 和 `1`，则大约 2/3 的分片会写入第一个节点。

注意：manifest 不保存节点密钥；节点密钥保存在主控 KV 中。删除分布式文件时，主控会按 manifest 清理各节点上的分片。

容量显示会把主控账号和所有已添加节点合并计算。默认每个账号/节点按 10 GB 计入总容量；例如主控加 2 个节点时，总容量显示为 30 GB。点击侧边栏底部容量区域可展开查看每个节点的使用情况。

### 共享文件夹

1. 创建根目录下的文件夹 `shared`
2. 在此目录下上传需要公开分享的文件
3. 未登录用户可通过 `https://你的域名/shared` 访问和下载这些文件
4. 共享文件夹支持子目录结构

### WebDAV

WebDAV 地址：

```text
https://你的域名/dav
```

如果设置了 `ACCESS_PASSWORD`，WebDAV 使用 Basic Auth：用户名可随意填写，密码填写 `ACCESS_PASSWORD`。如果没有设置访问密码，则 WebDAV 公开可访问。

当前支持 `OPTIONS`、`PROPFIND`、`GET`、`HEAD`、`PUT`、`MKCOL`、`DELETE`、`MOVE`、`COPY`。注意：WebDAV 客户端上传通常是单次 `PUT`，仍受 Cloudflare 单次请求体大小限制；突破 100 MB 的分片上传主要适用于网页端上传。

## 项目结构

```
r2-cloud-drive/
├── worker.js        # 主程序（Cloudflare Worker）
└── README.MD        # 本文件
```

## 技术栈

- **运行时**：Cloudflare Workers
- **存储**：Cloudflare R2（文件存储）
- **缓存**：Cloudflare KV（剪贴板持久化）
- **前端**：纯 HTML + CSS + JavaScript（Material Design 风格）
- **图标**：Material Icons Round

## 常见问题

**Q：上传文件后看不到？**
A：上传完成后点击 Snackbar 的「刷新」按钮，或手动刷新页面。

**Q：复制/粘贴后页面刷新，数据丢失？**
A：本系统使用 KV 存储剪贴板数据，跨页面导航不会丢失。如果粘贴按钮不可用，请先执行复制/剪切操作。

**Q：如何清空剪贴板？**
A：复制/剪切后 Snackbar 会出现「清除」按钮，点击即可清除剪贴板数据。

**Q：共享文件放在哪里？**
A：共享文件夹对应 R2 存储桶中的 `shared/` 前缀。在主界面进入 `shared` 文件夹管理文件，未登录用户通过 `/shared` 访问。

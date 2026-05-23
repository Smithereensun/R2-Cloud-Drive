# R2 Cloud Drive ☁️

基于 Cloudflare Workers + R2 的免费云端硬盘，采用 Google Material Design 风格。

## 功能特性

- 📁 **文件管理**：上传、下载、删除、重命名、新建文件夹
- 🔄 **两种视图**：网格视图 / 列表视图，支持排序
- ✂️ **复制/剪切/粘贴**：通过 KV 持久化剪贴板，跨页面导航不丢失
- 🔗 **共享文件夹**：`/shared` 路径公开只读共享，无需登录即可下载
- 🌙 **夜间模式**：深色主题切换，自动记住偏好
- 📊 **容量显示**：实时显示已用存储空间（默认 10 GB）
- 🖱️ **右键菜单**：文件/文件夹右键快捷操作
- 🎯 **单击选中，双击操作**：单击选中文件，双击下载/进入文件夹
- 📤 **拖拽上传**：支持拖拽文件上传，显示上传进度

## 部署教程

### 前置条件

- [Cloudflare](https://dash.cloudflare.com/) 账号
- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（安装：`npm install -g wrangler`）

### 步骤 1：克隆并安装依赖

```bash
# 创建工作目录
mkdir r2-cloud-drive
cd r2-cloud-drive

# 复制 worker.js 到项目目录
# 将本项目中的 worker.js 放入此目录

# 初始化 wrangler 配置
wrangler init
```

### 步骤 2：创建 R2 存储桶

```bash
# 创建一个 R2 存储桶（名称自定）
wrangler r2 bucket create my-cloud-drive
```

### 步骤 3：创建 KV 命名空间

```bash
# 创建 KV 命名空间用于剪贴板持久化
wrangler kv:namespace create CLIPBOARD_KV
```

执行后会输出类似：
```
🌀 Creating namespace with title "my-cloud-drive-clipboard"
✨ Success!
Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "CLIPBOARD_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 步骤 4：配置 wrangler.toml

创建 `wrangler.toml` 文件：

```toml
name = "r2-cloud-drive"
main = "worker.js"
compatibility_date = "2024-01-01"

# R2 存储桶绑定
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "my-cloud-drive"  # 替换为你在步骤 2 创建的名称

# KV 命名空间绑定（剪贴板持久化）
[[kv_namespaces]]
binding = "CLIPBOARD_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # 替换为步骤 3 输出的 ID
```

### 步骤 5：设置环境变量（可选）

| 变量名 | 说明 | 是否必须 | 默认值 |
|--------|------|---------|--------|
| `ACCESS_PASSWORD` | 访问密码，不设置则为公开访问 | 可选 | 无 |
| `SITE_TITLE` | 站点标题 | 可选 | `R2 云盘` |

通过 Cloudflare Dashboard 或 Wrangler 设置：

```bash
# 设置访问密码
wrangler secret put ACCESS_PASSWORD
# 然后输入你的密码

# 设置站点标题
wrangler secret put SITE_TITLE
# 然后输入你的标题
```

也可以在 `wrangler.toml` 中设置变量（非敏感信息）：

```toml
[vars]
SITE_TITLE = "我的云盘"
```

### 步骤 6：部署

```bash
# 发布到 Cloudflare Workers
wrangler deploy
```

部署成功后，你会得到一个 `https://your-project.workers.dev` 的地址。

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

### 共享文件夹

1. 在主界面（已登录）点击侧边栏「共享文件夹」进入 `/?path=shared`
2. 在此目录下上传需要公开分享的文件
3. 未登录用户可通过 `https://你的域名/shared` 访问和下载这些文件
4. 共享文件夹支持子目录结构

## 项目结构

```
r2-cloud-drive/
├── worker.js        # 主程序（Cloudflare Worker）
├── wrangler.toml    # Cloudflare 配置
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

## License

MIT

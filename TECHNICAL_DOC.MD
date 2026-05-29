# R2 Cloud Drive 技术交接文档

本文档用于让其他 AI 或开发者快速理解本项目，避免反复通读 4000+ 行 `worker.js`。

## 1. 项目定位

这是一个单文件 Cloudflare Worker 云盘应用，前端页面、API 路由、鉴权、R2 文件读写、D1 元数据层、分布式存储节点逻辑全部写在 `worker.js` 中。

核心能力：

- Cloudflare Workers 提供 HTTP 服务。
- Cloudflare R2 存储真实文件对象和分布式文件 manifest。
- Cloudflare D1 作为 KV 风格元数据存储，维护虚拟路径、目录索引、剪贴板、存储节点配置和临时上传会话。
- 前端为服务端渲染的 HTML + CSS + 原生 JavaScript，Material Design 风格。
- `/shared` 虚拟目录公开只读，无需登录。
- 支持普通上传、R2 multipart 上传、分布式分片上传、Range 下载。

## 2. 文件结构

```text
.
├── worker.js          # 主程序：UI、API、R2/D1/分布式存储全部在此
├── README.MD          # 使用/部署说明，当前终端查看可能出现编码乱码
├── API说明文档.MD     # 项目介绍文件
├── TECHNICAL_DOC.md   # 本技术交接文档
└── version.json       # 版本信息文件，用于前端自动检查更新
```

当前仓库没有 `wrangler.toml`。部署时需要在 Cloudflare Dashboard 或 Wrangler 中绑定：

```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "your-bucket-name"

[[d1_databases]]
binding = "DB"
database_name = "your-db-name"
database_id = "your-database-id"
```

可选环境变量：

| 变量 | 用途 |
| --- | --- |
| `ACCESS_PASSWORD` | 登录密码；不设置则公开访问管理端 |
| `SITE_TITLE` | 站点标题 |
| `CLOUD_ICON_URL` | 顶部/登录页图标 |
| `LOGIN_BACKGROUND_URL` | 登录页背景图 |
| `STORAGE_NODE_TOKEN` | 当前 Worker 作为存储节点时校验主控请求 |
| `DOWNLOAD_RANGE_SIZE_MB` | 服务端拼接分布式文件时的内部读取片段大小，范围 1~32 MiB，默认 32 MiB |

## 3. 代码分层速览

`worker.js` 大致可以按行号分为这些区域：

| 区域 | 作用 |
| --- | --- |
| `MIME_TYPES`、`getMimeType`、`getFileIcon` 等 | 文件类型、图标、格式化、安全转义工具 |
| `renderHTML`、`renderLoginPage`、`renderSharedPage`、`renderDrivePage` | 服务端生成完整 HTML 页面 |
| HTML 内嵌 `<script>` | 前端交互：上传、下载、预览、剪贴板、主题、节点管理、孤儿清扫、版本检查 |
| 常量区：`SHARED_PREFIX` 起 | 后端核心常量 |
| D1 KV 封装：`ensureD1KvSchema`、`d1KvStore`、`requireFsKv` | 将 D1 包装成 KV 接口 |
| 虚拟文件系统：`putFileEntry`、`listDirectory`、`copyVirtualPath`、`moveVirtualPath`、`deleteVirtualPath` | 用 D1 元数据映射 R2 对象 |
| 分布式存储：`allocateDistributedParts`、`manifestResponse`、`streamManifestFile`、`handleStorageNodeApi` | 节点容量均衡、manifest、跨节点读写 |
| `export default.fetch` | 主路由入口 |

关键常量片段：

```js
const SHARED_PREFIX = 'shared';
const STORAGE_TOTAL_BYTES = 10 * 1024 * 1024 * 1024;

const SESSION_COOKIE = 'r2drive_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

const STORAGE_NODES_KV_KEY = 'storage_nodes';
const MULTIPART_SESSION_PREFIX = 'multipart_session_';
const R2_MULTIPART_SESSION_PREFIX = 'r2multipart_session_';
const D1_KV_TABLE = 'r2drive_kv';

const MAIN_STORAGE_NODE_ID = 'main';
const FS_FILE_PREFIX = 'r2drive:fs:file:';
const FS_FOLDER_PREFIX = 'r2drive:fs:folder:';
const FS_DIR_PREFIX = 'r2drive:fs:dir:';
const NODE_PART_PREFIX = 'r2drive_node_part_';
const STORAGE_NODE_USAGE_PREFIX = 'storage_node_usage:';

const MANIFEST_CONTENT_TYPE = 'application/vnd.r2drive.manifest+json';
const MANIFEST_VERSION = 1;
const DOWNLOAD_RANGE_SIZE_BYTES = 32 * 1024 * 1024;
const DISTRIBUTED_UPLOAD_THRESHOLD_BYTES = 512 * 1024;
```

注意：前端也有一组上传/下载阈值常量。目前代码中直传阈值和分布式阈值都是 `512 * 1024`（512 KiB），即大于 512 KiB 会倾向走分布式逻辑；分布式失败时自动回退到 R2 Multipart Upload。每个分片最大 90 MiB，最多 10,000 个 part。

## 4. D1 元数据设计

项目只创建一张 D1 表，把 D1 当 KV 使用：

```js
CREATE TABLE IF NOT EXISTS r2drive_kv (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL,
  expires_at INTEGER
)
```

KV 封装的核心行为：

```js
function d1KvStore(DB) {
  return {
    async get(key) { /* SELECT value, expires_at; 过期则删除 */ },
    async put(key, value, options = {}) { /* INSERT ... ON CONFLICT UPDATE */ },
    async delete(key) { /* DELETE BY key */ },
    async list({ prefix = '', cursor = '', limit = 1000 } = {}) {
      /* 按 key 范围分页列出 prefix */
    }
  };
}

function requireFsKv(env) {
  if (env.DB) return d1KvStore(env.DB);
  if (!env.CLIPBOARD_KV) throw new Error('DB binding is required for file path mapping');
  return env.CLIPBOARD_KV;
}
```

主要 key 约定：

| key 前缀 | value 内容 | 用途 |
| --- | --- | --- |
| `r2drive:fs:file:<virtualPath>` | 文件元数据 JSON | 虚拟路径到 R2 key/manifest 的映射 |
| `r2drive:fs:folder:<virtualPath>` | 文件夹元数据 JSON | 空文件夹和目录树 |
| `r2drive:fs:dir:<virtualPath>` | 目录索引 JSON | 加速列表展示 |
| `storage_nodes` | 节点配置数组 JSON | 主控保存外部存储节点 |
| `storage_node_usage:<nodeId>` | 数字 | 主控估算节点已用容量 |
| `multipart_session_<id>` | 分布式上传 session JSON | 分布式上传临时状态，24h TTL |
| `r2multipart_session_<uploadId>` | R2 multipart session JSON | R2 multipart 上传临时状态，24h TTL |
| `clipboard_<id>` | 剪贴板 JSON | 跨页面复制/剪切状态，24h TTL |

虚拟路径处理重点：

```js
function normalizeVirtualPath(path = '') {
  return String(path || '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function assertVirtualPath(path = '', options = {}) {
  const clean = normalizeVirtualPath(path);
  if (!clean && !options.allowRoot) throw new Error('invalid path');
  if (/[\u0000-\u001F]/.test(clean)) throw new Error('invalid path');
  const parts = clean.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) throw new Error('invalid path');
  return clean;
}
```

结论：R2 对象 key 不等于用户看到的路径。用户路径是 D1 里的虚拟路径，真实 R2 key 由 `createStorageKeyForPath` 生成，并通过 `fileEntry` 映射。

## 5. 文件元数据与目录索引

文件 entry 通常来自：

```js
function fileEntryFromR2Meta(path, storageKey, meta, overrides = {}) {
  return {
    type: 'file',
    path,
    name: virtualPathName(path),
    parent: virtualParentPath(path),
    storageKey,
    size: overrides.size ?? manifestSizeFromMetadata(meta) ?? meta.size ?? 0,
    contentType: overrides.contentType || meta.httpMetadata?.contentType || getMimeType(path),
    uploaded: overrides.uploaded || meta.uploaded?.toISOString?.() || new Date().toISOString(),
    storageType: overrides.storageType || 'r2',
    createdAt: overrides.createdAt || new Date().toISOString()
  };
}
```

目录列表核心是 `listDirectory(env, path)`：

- 优先读取 `r2drive:fs:dir:<path>` 目录索引。
- 文件夹和文件元数据分别存在 folder/file key。
- 新建、上传、复制、移动、删除都会同步更新目录索引。

常用操作函数：

| 函数 | 作用 |
| --- | --- |
| `putFolderEntry(env, path)` | 创建文件夹元数据并补齐父级 |
| `replaceFileEntry(env, R2, entry)` | 写入/替换文件映射，必要时清理旧 R2 引用 |
| `copyVirtualPath(env, R2, from, to)` | 复制文件或文件夹树 |
| `moveVirtualPath(env, R2, from, to)` | 移动/重命名文件或文件夹树 |
| `deleteVirtualPath(env, R2, path)` | 删除文件或文件夹树，批量 D1 操作 + 异步 R2 清理 |

**v1.1.5 ctx 修复**：`fetch` handler 新增 `ctx` (ExecutionContext) 参数，`scheduleStorageCleanup` 通过 `ctx.waitUntil()` 保持 Worker 存活直到 R2 对象删除完成，彻底解决删除后空间不释放的根因。所有静默错误吞没（`/* ignore */`）替换为 `console.error` 日志。

**v1.1.4 删除优化**：删除操作已重构为批量 D1 模式，性能大幅提升：

- 新增 `d1KvStore.batchDelete(keys)`：将多条 DELETE 合并为 `DB.batch()` 调用，每批最多 100 条。
- 新增 `d1KvStore.batchGetJson(keys)`：批量读取 JSON 值，用于在删除前一次性收集存储键。
- 新增 `collectVirtualPathPaths(env, folderPath)`：仅遍历目录索引收集路径，不再逐个读取文件条目，避免 N+1 查询。
- 新增 `batchDeleteKvKeys(env, keys)` / `batchGetKvJson(env, keys)`：带降级回退的批量操作封装。
- `scheduleStorageCleanup(env, R2, entries)`：R2 实际对象清理改为 fire-and-forget 异步执行，不再阻塞删除响应的 HTTP 返回。
- `deleteVirtualPath` / `deleteMultipleVirtualPaths` 重写：
  1. 轻量收集路径（仅读目录索引）
  2. 批量读取文件条目获取 storageKey
  3. 批量删除所有 D1 元数据
  4. 异步清理 R2 对象

对于含 500 个文件的文件夹，旧代码需 ~1000 次独立 D1 查询，新代码仅需 ~10-20 次批量查询。

## 6. HTTP 路由表

主入口：

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const R2 = env.R2_BUCKET;
    // node API -> 登录/公开共享 -> 鉴权 -> 管理 API/UI
  }
}
```

公开/半公开路由：

| 路由 | 方法 | 鉴权 | 作用 |
| --- | --- | --- | --- |
| `/api/node/*` | 多种 | 节点 token | 当前 Worker 作为存储节点时提供分片 PUT/GET/DELETE、ping、storage |
| `/login` | GET | 否 | 登录页 |
| `/api/login` | POST | 否 | 校验 `ACCESS_PASSWORD`，写 cookie |
| `/api/logout` | POST | 否 | 清理 cookie |
| `/shared` | GET | 否 | 公开共享目录 UI |
| `/api/shared-list` | GET | 否 | 公开共享目录列表 |
| `/api/download?path=shared/...` | GET/HEAD | 否 | 公开下载 shared 下文件 |
| `/api/clipboard` | GET/POST/DELETE | 代码中未强制登录 | 持久化剪贴板 |

需要登录的管理路由：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/` | GET | 主云盘页面 |
| `/api/list?path=` | GET | 列目录 |
| `/api/storage` | GET | 总容量和各节点容量 |
| `/api/storage-nodes` | GET/POST/DELETE | 管理外部存储节点 |
| `/api/storage-nodes/test?id=` | POST | 测试节点连通和容量 |
| `/api/download?path=` | GET/HEAD | 下载/预览文件，支持 Range |
| `/api/upload?path=` | POST | 普通直传到主 R2 |
| `/api/multipart/init` | POST | 初始化 R2 multipart 上传 |
| `/api/multipart/part` | POST | 上传 R2 multipart part |
| `/api/multipart/complete` | POST | 完成 R2 multipart 上传并写 D1 映射 |
| `/api/multipart/abort` | POST | 中止 R2 multipart |
| `/api/distributed/init` | POST | 初始化分布式上传，分配节点 |
| `/api/distributed/main-part` | PUT | 上传分布式 part 到主控 R2 |
| `/api/distributed/complete` | POST | 写 manifest，登记文件 |
| `/api/distributed/abort` | POST | 清理未完成分片 |
| `/api/clipboard/paste` | POST | 服务端复制/移动 |
| `/api/delete?path=` | DELETE | 删除虚拟文件/目录（单文件/文件夹） |
| `/api/delete-batch` | POST | 批量删除（body: `{"paths": [...]}`），内部使用批量 D1 操作 |
| `/api/orphan-cleanup` | POST | 孤儿文件扫描（`action: "scan"`）与清理（`action: "clean"`） |
| `/api/rename` | POST | 移动/重命名 |
| `/api/mkdir` | POST | 创建文件夹 |

鉴权逻辑：

```js
async function isAuthenticated(request, env) {
  if (!env.ACCESS_PASSWORD) return true;
  const token = getCookie(request, SESSION_COOKIE);
  return token && await verifyToken(token, env.ACCESS_PASSWORD);
}
```

注意：`verifyToken` 当前只解析 token 时间并检查 7 天有效期，没有重新校验 HMAC 签名：

```js
async function verifyToken(token, secret) {
  try {
    const { t, s } = JSON.parse(atob(token));
    if (Date.now() - t > SESSION_DURATION) return false;
    return true; // simplified - production: re-verify HMAC
  } catch { return false; }
}
```

如果要增强安全性，优先修这里。

## 7. 上传流程

前端入口是 `uploadFiles -> uploadSingleFile`。关键阈值：

```js
const DIRECT_UPLOAD_LIMIT = 512 * 1024;
const MULTIPART_DEFAULT_CHUNK = 32 * 1024 * 1024;
const MULTIPART_MAX_CHUNK = 90 * 1024 * 1024;
const MULTIPART_MAX_PARTS = 10000;
```

当前意图：

- 小文件：`/api/upload` 直接写主 R2。
- 较大文件：前端优先走 `/api/distributed/init` 分布式分片。
- 如果分布式失败，代码里可能回退到 R2 multipart，具体看 `uploadSingleFile`、`uploadDistributed`、`uploadMultipart`。

### 7.1 普通上传

```js
if (path === '/api/upload' && request.method === 'POST') {
  const filePath = url.searchParams.get('path');
  const cleanPath = assertVirtualPath(filePath);
  const mime = getMimeType(filePath);
  const storageKey = await createStorageKeyForPath(env, R2, cleanPath, 'file');
  const object = await R2.put(storageKey, request.body, {
    httpMetadata: { contentType: mime }
  });
  await replaceFileEntry(env, R2, fileEntryFromR2Meta(cleanPath, storageKey, object, {
    contentType: mime,
    storageType: 'r2'
  }));
  return Response.json({ ok: true });
}
```

### 7.2 R2 multipart 上传

流程：

1. `/api/multipart/init` 创建 R2 multipart upload，并把 session 写入 D1 KV。
2. `/api/multipart/part` 上传每个 part。
3. `/api/multipart/complete` complete 后写入 D1 文件映射。
4. `/api/multipart/abort` 中止并删除 session。

session key：`r2multipart_session_<uploadId>`，TTL 24 小时。

### 7.3 分布式上传（文件映射 + 分片存储）

#### 7.3.1 核心概念：两层解耦

虚拟文件系统通过 **文件映射表（D1）** + **分片存储（R2）** 两层解耦实现分布式存储。用户看到的是虚拟路径，实际数据以分片形式散落在各节点 R2 中，主控 R2 只保存 manifest 索引。

| 概念 | 存储位置 | 内容 | 类比 |
|------|---------|------|------|
| **虚拟路径** | 用户心智模型 | `videos/movie.mp4` | 你看到的文件名 |
| **文件映射（D1 entry）** | 主控 D1 | `{storageKey: "manifest_xyz", storageType: "distributed", size: 1GB}` | 文件的"身份证" |
| **Manifest（分片索引）** | 主控 R2 | `{parts: [{nodeId:"node-1", key:"part_001", size:32MB}, ...]}` | 分片的"藏宝图" |
| **分片（Part）** | 各节点 R2 | 实际二进制数据片段 | 拼图的"碎片" |

#### 7.3.2 文件映射表（D1 → R2 的桥梁）

每种 `storageType` 对应不同的映射逻辑：

| storageType | D1 中的 storageKey | R2 中实际存储的内容 | 适用场景 |
|------------|-------------------|-------------------|---------|
| `r2` | `file_a1b2c3`（UUID） | 完整文件二进制 | 小文件直传 |
| `distributed` | `manifest_d4e5f6`（UUID） | Manifest JSON → 指向各节点分片 | 大文件分布式 |
| `multipart_session_*` | 临时 session key | 上传中的临时状态 | 上传进行中 |

**文件复制时的去重**：当用户复制文件时，新旧虚拟路径的 D1 entry 指向**同一个 storageKey**，不会在 R2 中重复存储数据。删除时需检查该 storageKey 是否还有其他虚拟路径引用。

```
复制前:
   D1: r2drive:fs:file:photos/a.jpg → storageKey: file_abc → R2: file_abc (实际数据)

复制后 (photos/a.jpg → backup/a.jpg):
   D1: r2drive:fs:file:photos/a.jpg  → storageKey: file_abc ─┐
   D1: r2drive:fs:file:backup/a.jpg  → storageKey: file_abc ─┤ 指向同一个 R2 对象
                                                              │
   R2: file_abc (实际数据) ←────────────────────────────────┘
```

#### 7.3.3 分布式文件的分片结构

以 1 GB 的 `movie.mp4` 为例，分 32 个 32 MB 分片，分配到 3 个节点（主控 + 节点A + 节点B）：

```
┌─────────────────────────────────────────────────────────────────┐
│  D1 文件映射                                                     │
│  key: "r2drive:fs:file:videos/movie.mp4"                        │
│  value: { storageKey: "manifest_xyz", storageType: "distributed" }│
└──────────────────────────┬──────────────────────────────────────┘
                           │ 指向
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  主控 R2: manifest_xyz (Manifest JSON)                           │
│  {                                                               │
│    "type": "distributed-file",                                   │
│    "version": 1,                                                 │
│    "size": 1073741824,                                           │
│    "contentType": "video/mp4",                                   │
│    "parts": [                                                    │
│      { "partNumber": 1,  "size": 32MB, "nodeId": "main",        │
│        "key": "r2drive_node_part_sessionX_000001" },             │
│      { "partNumber": 2,  "size": 32MB, "nodeId": "node-A",      │
│        "key": "r2drive_node_part_sessionX_000002" },             │
│      { "partNumber": 3,  "size": 32MB, "nodeId": "node-B",      │
│        "key": "r2drive_node_part_sessionX_000003" },             │
│      ... (共 32 个 part)                                         │
│    ]                                                             │
│  }                                                               │
└───────┬──────────────────┬──────────────────┬───────────────────┘
        │ 主控 R2          │ 节点A R2          │ 节点B R2
        ▼                  ▼                  ▼
   ┌─────────┐       ┌─────────┐       ┌─────────┐
   │ part_001│       │ part_002│       │ part_003│
   │ (32 MB) │       │ (32 MB) │       │ (32 MB) │
   ├─────────┤       ├─────────┤       ├─────────┤
   │ part_004│       │ part_005│       │ part_006│
   │ (32 MB) │       │ (32 MB) │       │ (32 MB) │
   ├─────────┤       ├─────────┤       ├─────────┤
   │  ...    │       │  ...    │       │  ...    │
   └─────────┘       └─────────┘       └─────────┘
   主控 12 个 part    节点A 10 个 part    节点B 10 个 part
```

#### 7.3.4 下载时的分片拼接

下载 `movie.mp4` 时，Worker 按 manifest 的 parts 数组顺序，从各节点 R2 逐片拉取并流式拼接输出：

| 步骤 | 操作 | 数据来源 |
|------|------|---------|
| 1 | 读 D1 获取 `{storageKey: "manifest_xyz", storageType: "distributed"}` | 主控 D1 |
| 2 | 读 R2 获取 manifest JSON，得到 32 个 part 的信息 | 主控 R2 |
| 3 | 按 `partNumber` 排序 → 依次拉取每个 part | — |
| 3a | `nodeId == "main"` → `R2.get(partKey)` | 主控 R2 |
| 3b | `nodeId != "main"` → `fetch(nodeUrl + /api/node/part?key=...)` (Bearer token) | 外部节点 |
| 4 | ReadableStream 流式拼接各 part → 返回给客户端 | Worker 内存 |

#### 7.3.5 节点用量追踪

主控 D1 维护 `storage_node_usage:<nodeId>` 记录各节点已上传的累计字节数，作为分配算法的 `used` 输入：

| D1 Key | Value | 更新时机 |
|--------|-------|---------|
| `storage_node_usage:main` | `{"used": 402653184}` | 分布式上传 complete 时 +Δ |
| `storage_node_usage:node-A` | `{"used": 335544320}` | 分布式上传 complete 时 +Δ |
| `storage_node_usage:node-B` | `{"used": 335544320}` | 分布式上传 complete 时 +Δ |

**容量估算 vs 实时查询**：分配节点时，`used` 取 D1 估算值和节点实时容量查询值的**最大值**，避免因容量统计延迟导致新上传过度分配给刚完成上传的节点。

## 8. 下载与 Range

统一下载入口：

```js
if (path === '/api/download') {
  const filePath = url.searchParams.get('path');
  return storedVirtualFileResponse(request, R2, filePath, env);
}
```

`storedVirtualFileResponse` 会：

1. 查 D1 中的 file entry。
2. 根据 `storageKey` 读 R2。
3. 如果对象是普通文件，走 `r2ObjectResponse`。
4. 如果对象是 manifest，走 `manifestResponse`。

普通 R2 文件支持 `Range`：

```js
function parseByteRange(rangeHeader, size) { /* 解析 bytes=start-end */ }
function r2RangeOptions(range) {
  return range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {};
}
```

分布式文件下载：

- `manifestResponse` 根据总大小解析 Range。
- `streamManifestFile`/`concatManifestPartStreams` 按 manifest parts 顺序拉取。
- 主控 R2 part 用 `R2.get`。
- 外部节点 part 用 `/api/node/part?key=...`，带 `Authorization: Bearer <token>`。
- 内部读取片段默认 32 MiB，输出 chunk 256 KiB。

前端大文件下载：

- 文件大小 >= 512 MiB 且浏览器支持 `showSaveFilePicker` 时，使用分段 Range 下载到本地文件。
- 每个前端 Range 请求大小为 512 MiB。

## 9. 存储节点模式

同一份 `worker.js` 可部署成主控，也可部署成外部存储节点。

节点 API 入口：

```js
if (path.startsWith('/api/node/')) {
  return handleStorageNodeApi(request, env);
}
```

节点鉴权：

```js
function isNodeRequestAuthorized(request, env) {
  const expected = env.STORAGE_NODE_TOKEN || env.ACCESS_PASSWORD;
  if (!expected) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${expected}`;
}
```

节点提供：

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/api/node/ping` | GET | 健康检查 |
| `/api/node/storage` | GET | 统计节点 R2 已用容量和总容量 |
| `/api/node/part?key=&size=` | PUT | 保存分片 |
| `/api/node/part?key=` | GET/HEAD | 读取分片，支持 Range |
| `/api/node/part?key=` | DELETE | 删除分片 |

主控保存节点配置时，返回给前端的 `publicNode` 不包含 token；token 只留在 D1 的 `storage_nodes` 中。

## 10. 前端页面与交互

服务端渲染：

| 函数 | 页面 |
| --- | --- |
| `renderLoginPage` | 登录页 |
| `renderSharedPage` | 公开共享页 |
| `renderDrivePage` | 管理端云盘页 |
| `renderHTML` | 通用 HTML 外壳和 CSS |

前端主要函数：

| 函数 | 用途 |
| --- | --- |
| `setView` | 网格/列表视图切换 |
| `openPreview` / `loadPreview` | 图片/视频/音频/PDF/文本预览 |
| `copySelected` / `cutSelected` / `pasteFiles` | 剪贴板操作 |
| `uploadFiles` / `uploadSingleFile` | 上传调度 |
| `downloadInRanges` | 大文件分段下载 |
| `loadStorageNodes` / `saveStorageNode` | 节点管理弹窗 |
| `updateStorageInfo` | 容量显示 |
| `toggleDarkMode` | 深色模式 |

代码是内嵌在 HTML 字符串中的脚本，修改时要注意模板字符串转义、中文和 `${...}` 插值。

**前端资源（CDN 与字体）**：为了中国大陆访问速度，前端已不再引用 Google Fonts 和 Google Material Icons CDN：
- 字体使用系统原生字体栈（`PingFang SC`、`Microsoft YaHei` 等），不依赖外部字体服务。
- Material Icons 图标字体通过 BootCDN（`cdn.bootcdn.net`）加载，并额外定义了 `.material-icons-round` 的字体规则以兼容原有类名。
- 如需恢复 Google 原版 CDN 或更换其他 CDN，修改 `renderHTML` 中的 `<link>` 标签和对应 CSS 变量即可。

## 11. 关键业务规则

- `shared` 是固定公开目录名；未登录用户只能列表和下载 `shared/` 下内容。
- 虚拟路径不能包含控制字符、`.`、`..`。
- 文件夹是 D1 元数据概念，不一定对应 R2 prefix。
- R2 根目录保存真实对象；D1 负责映射虚拟目录。
- 复制文件时可能复用同一 `storageKey`；删除时必须检查是否还有其他虚拟路径引用。
- 分布式文件的真实内容散落在主控 R2 和外部节点 R2；主控 R2 保存 manifest 索引。
- 删除分布式文件时必须清理 manifest 中列出的所有 part，并更新节点用量估算。
- 外部节点 token 不写入 manifest，只保存在主控 D1 的节点配置里。

## 12. 快速定位清单

想改登录：

- `generateToken`
- `verifyToken`
- `isAuthenticated`
- `/login`
- `/api/login`
- `/api/logout`

想改文件列表：

- `listDirectory`
- `getDirectoryIndex`
- `renderDrivePage`
- `/api/list`

想改上传：

- 前端：`uploadSingleFile`、`uploadDirect`、`uploadMultipart`、`uploadDistributed`
- 后端：`/api/upload`、`/api/multipart/*`、`/api/distributed/*`

想改下载：

- 前端：`startDownload`、`downloadInRanges`
- 后端：`storedVirtualFileResponse`、`storedFileResponse`、`manifestResponse`、`streamManifestFile`

想改节点：

- `getStorageNodes`
- `saveStorageNodes`
- `allocateDistributedParts`
- `handleStorageNodeApi`
- `/api/storage-nodes*`

想改复制/移动/删除：

- `copyVirtualPath`
- `moveVirtualPath`
- `deleteVirtualPath` / `deleteMultipleVirtualPaths`
- `collectVirtualPathPaths`（轻量路径收集，仅读索引）
- `batchDeleteKvKeys` / `batchGetKvJson`（批量 D1 操作封装）
- `scheduleStorageCleanup`（异步 R2 清理，不阻塞响应）
- `cleanupUnreferencedStorage`
- `/api/clipboard/paste`
- `/api/delete`
- `/api/delete-batch`
- `/api/rename`

想改孤儿清扫：

- `findOrphanStorageKeys` / `deleteOrphanStorageKeys`
- `findAllReferencedStorageKeys` / `collectManifestPartKeys`
- `/api/orphan-cleanup`
- 前端：`openOrphanCleanup` / `scanOrphans` / `deleteSelectedOrphans`

想改版本检查：

- `version.json`（仓库根目录）
- 前端：`checkVersionUpdate` / `applyVersionResult`
- 前端常量：`CURRENT_VERSION` / `CURRENT_VERSION_CODE` / `VERSION_CHECK_URL`

## 13. 版本更新检查

### version.json

仓库根目录的 `version.json` 用于前端自动版本检查：

```json
{
  "version": "1.1.5",
  "versionCode": 115,
  "releaseDate": "2026-05-29",
  "releaseNotes": "...",
  "downloadUrl": "https://github.com/HandsomeMJZ/R2-Cloud-Drive"
}
```

| 字段 | 说明 |
| --- | --- |
| `version` | 语义化版本号（展示用） |
| `versionCode` | 整数版本码（比较用）：major×100 + minor×10 + patch |
| `releaseDate` | 发布日期 |
| `releaseNotes` | 更新说明 |
| `downloadUrl` | 下载/仓库链接 |

### 前端检查逻辑

- 页面加载时自动 fetch GitHub Raw URL：`https://raw.githubusercontent.com/HandsomeMJZ/R2-Cloud-Drive/main/version.json`
- 比较远程 `versionCode` 与当前 `CURRENT_VERSION_CODE`（常量 115）
- 检查结果缓存到 `sessionStorage`，6 小时内不重复请求
- 如果有新版本：页脚版本号旁显示红色「有新版本」角标，悬停弹出 tooltip 显示更新详情
- 如果已是最新：tooltip 显示绿色「已是最新版本」

### 发布新版本时的操作

1. 更新 `worker.js` 页脚版本号和 `CURRENT_VERSION` / `CURRENT_VERSION_CODE` 常量
2. 更新 `version.json` 中的版本号、版本码、发布日期和更新说明
3. 提交并推送到 GitHub main 分支
4. 所有已部署的 Worker 实例会在用户下次访问时自动检测到更新

## 14. 最小调用示例

登录：

```http
POST /api/login
Content-Type: application/json

{"password":"your-password"}
```

列目录：

```http
GET /api/list?path=folder/subfolder
```

普通上传：

```http
POST /api/upload?path=folder/a.txt
Content-Type: text/plain

hello
```

下载：

```http
GET /api/download?path=folder/a.txt
Range: bytes=0-1023
```

创建文件夹：

```http
POST /api/mkdir
Content-Type: application/json

{"path":"folder/new-dir"}
```

重命名/移动：

```http
POST /api/rename
Content-Type: application/json

{"from":"folder/a.txt","to":"folder/b.txt"}
```

删除：

```http
DELETE /api/delete?path=folder/b.txt
```

批量删除：

```http
POST /api/delete-batch
Content-Type: application/json

{"paths":["folder/a.txt","folder/subdir","another/file.pdf"]}
```

响应示例：

```json
{"ok":true,"deleted":3,"cleanupFailed":0}
```

> 注意：删除操作已优化为批量 D1 模式，元数据删除完成后立即返回响应，R2 实际对象清理在后台异步执行（best-effort）。

分布式上传初始化：

```http
POST /api/distributed/init
Content-Type: application/json

{
  "path": "big/video.mp4",
  "size": 1048576000,
  "contentType": "video/mp4",
  "chunkSize": 33554432,
  "parts": 32
}
```

完成分布式上传：

```http
POST /api/distributed/complete
Content-Type: application/json

{"sessionId":"..."}
```


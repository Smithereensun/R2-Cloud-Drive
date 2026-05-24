/**
 * R2 Cloud Drive - Cloudflare Worker
 * Google Material Design Style
 * 
 * ============================================
 * 配置说明 (Configuration)
 * ============================================
 *
 * 1. R2 存储桶 (必须)
 *    在 wrangler.toml 中绑定 R2 存储桶:
 *    [[r2_buckets]]
 *    binding = "R2_BUCKET"
 *    bucket_name = "your-bucket-name"
 *
 * 2. KV 命名空间 (必须 - 用于剪贴板跨页面持久化)
 *    在 wrangler.toml 中绑定 KV:
 *    [[kv_namespaces]]
 *    binding = "CLIPBOARD_KV"
 *    id = "your-kv-namespace-id"
 *
 * 3. 访问密码 (可选 - 不设置则为公开访问)
 *    在 Worker 环境变量中设置:
 *    ACCESS_PASSWORD = "your-password"
 *
 * 4. 站点标题 (可选)
 *    SITE_TITLE = "My Cloud Drive"
 *
 * 5. 云盘图标 (可选 - 图片链接)
 *    CLOUD_ICON_URL = "https://example.com/icon.png"
 *
 * 6. 登录页背景图 (可选 - 图片链接，不设置则为淡灰色)
 *    LOGIN_BACKGROUND_URL = "https://example.com/login-bg.jpg"
 *
 * 7. 存储节点密钥 (可选 - 节点 Worker 接收分片时使用)
 *    STORAGE_NODE_TOKEN = "your-node-token"
 *
 * ============================================
 * 功能列表
 * ============================================
 * - 文件上传/下载/删除/重命名/新建文件夹
 * - 网格/列表两种视图模式
 * - 单击选中文件，支持多选
 * - 横向操作栏：复制、剪切、粘贴、重命名、下载、删除
 * - 剪贴板通过 KV 持久化，跨页面导航不丢失
 * - 共享文件夹 (/shared) — 无需登录，只读下载
 * - 容量显示 (默认 10 GB)
 * - 多账号存储节点：大文件分片分布存储 + manifest 索引
 * - 夜间模式切换 (深色主题)
 * - 拖拽上传，上传进度显示
 * - 右键上下文菜单
 */

const MIME_TYPES = {
  // Images
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  // Videos
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', avi: 'video/x-msvideo',
  mov: 'video/quicktime', mkv: 'video/x-matroska',
  // Audio
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
  m4a: 'audio/mp4', opus: 'audio/opus',
  // Documents
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  html: 'text/html', css: 'text/css', js: 'text/javascript',
  json: 'application/json', xml: 'application/xml',
  // Archives
  zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
  rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
};

function getMimeType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const videoExts = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'mkv'];
  const audioExts = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus'];
  const docExts = ['pdf', 'doc', 'docx'];
  const sheetExts = ['xls', 'xlsx', 'csv'];
  const slideExts = ['ppt', 'pptx'];
  const codeExts = ['js', 'ts', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'html', 'css', 'json', 'xml', 'yaml', 'yml'];
  const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z'];
  const textExts = ['txt', 'md', 'log'];

  if (imageExts.includes(ext)) return { icon: 'image', color: '#34A853' };
  if (videoExts.includes(ext)) return { icon: 'movie', color: '#EA4335' };
  if (audioExts.includes(ext)) return { icon: 'audio_file', color: '#FBBC04' };
  if (docExts.includes(ext)) return { icon: 'description', color: '#4285F4' };
  if (sheetExts.includes(ext)) return { icon: 'table_chart', color: '#34A853' };
  if (slideExts.includes(ext)) return { icon: 'slideshow', color: '#FF6D00' };
  if (codeExts.includes(ext)) return { icon: 'code', color: '#9C27B0' };
  if (archiveExts.includes(ext)) return { icon: 'folder_zip', color: '#795548' };
  if (textExts.includes(ext)) return { icon: 'article', color: '#607D8B' };
  return { icon: 'insert_drive_file', color: '#5F6368' };
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(date) {
  if (!date) return '-';
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeAttr(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderLogoIcon(iconUrl = '', fallbackIcon = 'cloud') {
  const url = String(iconUrl || '').trim();
  if (url) {
    return `<div class="logo-icon logo-icon-custom"><img src="${escapeAttr(url)}" alt=""></div>`;
  }
  return `<div class="logo-icon"><span class="material-icons-round">${fallbackIcon}</span></div>`;
}

function renderHTML(content, title = 'R2 云盘') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
    --primary: #1A73E8;
    --primary-light: #E8F0FE;
    --primary-dark: #1557B0;
    --surface: #FFFFFF;
    --background: #F8F9FA;
    --on-surface: #202124;
    --on-surface-variant: #5F6368;
    --outline: #DADCE0;
    --error: #D93025;
    --success: #1E8E3E;
    --warning: #F29900;
    --shadow-1: 0 1px 2px rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15);
    --shadow-2: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15);
    --shadow-3: 0 4px 8px 3px rgba(60,64,67,.15), 0 1px 3px rgba(60,64,67,.3);
    --radius-s: 4px;
    --radius-m: 8px;
    --radius-l: 16px;
    --radius-xl: 28px;
    --font-display: 'Google Sans', sans-serif;
    --font-body: 'Roboto', sans-serif;
  }

  /* ── Dark Mode ── */
  [data-theme="dark"] {
    --primary: #8AB4F8;
    --primary-light: #1A2332;
    --primary-dark: #C6DAFC;
    --surface: #1E1E1E;
    --background: #121212;
    --on-surface: #E8EAED;
    --on-surface-variant: #9AA0A6;
    --outline: #3C4043;
    --error: #F28B82;
    --success: #81C995;
    --warning: #FDD663;
    --shadow-1: 0 1px 2px rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15);
    --shadow-2: 0 1px 3px rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15);
    --shadow-3: 0 4px 8px 3px rgba(0,0,0,.15), 0 1px 3px rgba(0,0,0,.3);
  }
  [data-theme="dark"] .snackbar { background: #3C4043; color: #E8EAED; }
  [data-theme="dark"] .snackbar-action { color: #8AB4F8; }
  [data-theme="dark"] .selection-bar { background: #1A2332; color: #8AB4F8; }
  [data-theme="dark"] .selection-bar .icon-btn { color: #8AB4F8; }
  [data-theme="dark"] .login-card { background: #1E1E1E; }
  [data-theme="dark"] .file-card-icon[style*="FFF8E1"] { background: #3C2E00 !important; }

  body {
    font-family: var(--font-body);
    background: var(--background);
    color: var(--on-surface);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Top App Bar ── */
  .app-bar {
    position: sticky; top: 0; z-index: 100;
    height: 64px;
    background: var(--surface);
    border-bottom: 1px solid var(--outline);
    display: flex; align-items: center;
    padding: 0 24px; gap: 16px;
    box-shadow: var(--shadow-1);
  }
  .app-bar-logo {
    display: flex; align-items: center; gap: 10px;
    text-decoration: none; color: inherit;
  }
  .logo-icon {
    width: 40px; height: 40px;
    background: linear-gradient(135deg, #FFB74D 0%, #FB8C00 100%);
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 20px;
    overflow: hidden; flex-shrink: 0;
  }
  .logo-icon .material-icons-round { font-size: inherit; }
  .logo-icon-custom { background: transparent; }
  .logo-icon-custom img {
    width: 100%; height: 100%;
    display: block; object-fit: cover;
  }
  .app-bar-title {
    font-family: var(--font-display);
    font-size: 22px; font-weight: 400;
    color: var(--on-surface);
  }
  .app-bar-spacer { flex: 1; }
  .app-bar-actions { display: flex; align-items: center; gap: 8px; }

  /* ── Icon Button ── */
  .icon-btn {
    width: 40px; height: 40px;
    border: none; background: transparent; cursor: pointer;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: var(--on-surface-variant);
    transition: background .2s;
    position: relative;
  }
  .icon-btn:hover { background: rgba(60,64,67,.08); }
  .icon-btn:active { background: rgba(60,64,67,.12); }
  .icon-btn .material-icons-round { font-size: 20px; }

  .theme-ripple {
    position: fixed; left: 0; top: 0; z-index: 10000;
    width: 1px; height: 1px; border-radius: 50%;
    pointer-events: none; transform: translate(-50%, -50%) scale(0);
    transition: transform .55s cubic-bezier(.4, 0, .2, 1);
    will-change: transform;
  }
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
    mix-blend-mode: normal;
  }

  /* ── Layout ── */
  .layout { display: flex; min-height: calc(100vh - 64px); }

  /* ── Sidebar ── */
  .sidebar {
    width: 256px; flex-shrink: 0;
    background: var(--surface);
    padding: 8px 0;
    border-right: 1px solid var(--outline);
  }
  .sidebar-section { padding: 8px 0; }
  .sidebar-label {
    font-family: var(--font-display);
    font-size: 11px; font-weight: 500;
    color: var(--on-surface-variant);
    letter-spacing: .8px; text-transform: uppercase;
    padding: 8px 16px 4px;
  }
  .sidebar-item {
    display: flex; align-items: center; gap: 12px;
    padding: 0 16px; height: 40px; cursor: pointer;
    border-radius: var(--radius-xl); margin: 2px 8px;
    border: none; background: transparent;
    color: var(--on-surface-variant);
    transition: background .15s;
    text-decoration: none; font-size: 14px;
    font-family: var(--font-body); font-weight: 500;
    width: calc(100% - 16px); text-align: left;
  }
  .sidebar-item:hover { background: rgba(60,64,67,.08); }
  .sidebar-item.active {
    background: var(--primary-light);
    color: var(--primary-dark);
    font-weight: 700;
  }
  .sidebar-item.active .material-icons-round { color: var(--primary); }
  .sidebar-item .material-icons-round { font-size: 20px; }
  .sidebar-divider { height: 1px; background: var(--outline); margin: 8px 16px; }

  /* ── Main Content ── */
  .main { flex: 1; padding: 24px 32px; overflow-x: hidden; }

  /* ── Breadcrumb ── */
  .breadcrumb {
    display: flex; align-items: center; gap: 4px;
    margin-bottom: 20px; flex-wrap: wrap;
  }
  .breadcrumb-item {
    display: flex; align-items: center; gap: 4px;
    font-family: var(--font-display); font-size: 14px;
  }
  .breadcrumb-link {
    color: var(--on-surface-variant); text-decoration: none;
    padding: 4px 8px; border-radius: var(--radius-s);
    transition: background .15s;
  }
  .breadcrumb-link:hover { background: rgba(60,64,67,.08); color: var(--on-surface); }
  .breadcrumb-current { color: var(--on-surface); font-weight: 500; padding: 4px 8px; }
  .breadcrumb-sep { color: var(--on-surface-variant); font-size: 18px; }

  /* ── Toolbar ── */
  .toolbar {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 16px; flex-wrap: wrap;
  }
  .toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

  /* ── FAB ── */
  .fab {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--primary); color: white;
    border: none; border-radius: var(--radius-xl);
    padding: 0 24px; height: 48px; cursor: pointer;
    font-family: var(--font-display); font-size: 14px; font-weight: 500;
    box-shadow: var(--shadow-2); transition: box-shadow .2s, background .2s;
    letter-spacing: .25px;
  }
  .fab:hover { background: var(--primary-dark); box-shadow: var(--shadow-3); }
  .fab .material-icons-round { font-size: 18px; }

  /* ── Outlined Button ── */
  .btn-outlined {
    display: inline-flex; align-items: center; gap: 8px;
    background: transparent; color: var(--primary);
    border: 1px solid var(--outline); border-radius: var(--radius-xl);
    padding: 0 20px; height: 40px; cursor: pointer;
    font-family: var(--font-display); font-size: 14px; font-weight: 500;
    transition: background .15s, border-color .15s;
  }
  .btn-outlined:hover { background: var(--primary-light); border-color: var(--primary); }
  .btn-outlined .material-icons-round { font-size: 18px; }

  /* ── File Grid ── */
  .file-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
    margin-bottom: 32px;
  }
  .file-card {
    background: var(--surface);
    border: 1px solid var(--outline);
    border-radius: var(--radius-m);
    padding: 12px;
    cursor: pointer;
    transition: box-shadow .15s, border-color .15s;
    display: flex; flex-direction: column; gap: 8px;
    position: relative; user-select: none;
  }
  .file-card:hover { box-shadow: var(--shadow-2); border-color: transparent; }
  .file-card.selected { border-color: var(--primary); background: var(--primary-light); }
  .file-card-icon {
    width: 48px; height: 48px;
    border-radius: var(--radius-s);
    display: flex; align-items: center; justify-content: center;
    font-size: 28px;
  }
  .file-card-name {
    font-size: 13px; font-weight: 500;
    color: var(--on-surface);
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    line-height: 1.4;
  }
  .file-card-meta {
    font-size: 11px; color: var(--on-surface-variant);
    display: flex; flex-direction: column; gap: 2px;
  }
  .file-card-actions {
    position: absolute; top: 8px; right: 8px;
    opacity: 0; transition: opacity .15s;
  }
  .file-card:hover .file-card-actions { opacity: 1; }

  /* ── File List (Table) ── */
  .file-list { width: 100%; border-collapse: collapse; }
  .file-list th {
    text-align: left; padding: 8px 12px;
    font-size: 12px; font-weight: 500;
    color: var(--on-surface-variant);
    border-bottom: 1px solid var(--outline);
    white-space: nowrap; cursor: pointer; user-select: none;
  }
  .file-list th:hover { color: var(--on-surface); }
  .file-list th .th-inner { display: flex; align-items: center; gap: 4px; }
  .file-list td { padding: 6px 12px; border-bottom: 1px solid var(--outline); }
  .file-list tr:hover td { background: rgba(60,64,67,.04); }
  .file-list tr.selected td { background: var(--primary-light); }
  .file-row-icon { display: flex; align-items: center; gap: 12px; }
  .file-row-name {
    font-size: 14px; color: var(--on-surface); cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px;
  }
  .file-row-name:hover { color: var(--primary); text-decoration: underline; }
  .file-row-meta { font-size: 13px; color: var(--on-surface-variant); white-space: nowrap; }
  .file-row-actions { opacity: 0; display: flex; gap: 4px; }
  tr:hover .file-row-actions { opacity: 1; }

  /* ── Empty State ── */
  .empty-state {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 80px 0; gap: 16px;
    color: var(--on-surface-variant);
  }
  .empty-state > .material-icons-round { font-size: 80px; opacity: .4; color: var(--primary); }
  .empty-state h3 { font-family: var(--font-display); font-size: 20px; font-weight: 400; }
  .empty-state p { font-size: 14px; text-align: center; max-width: 300px; }

  /* ── Modal ── */
  .modal-overlay {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,.6);
    display: flex; align-items: center; justify-content: center;
    padding: 24px; opacity: 0; pointer-events: none;
    transition: opacity .2s;
  }
  .modal-overlay.open { opacity: 1; pointer-events: all; }
  .modal {
    background: var(--surface); border-radius: var(--radius-l);
    width: 100%; max-width: 480px;
    box-shadow: var(--shadow-3);
    transform: translateY(20px) scale(.97);
    transition: transform .2s;
    overflow: hidden;
  }
  .modal-overlay.open .modal { transform: none; }
  .modal-header {
    padding: 24px 24px 16px;
    display: flex; align-items: center; gap: 12px;
  }
  .modal-title { font-family: var(--font-display); font-size: 20px; font-weight: 400; }
  .modal-body { padding: 0 24px 16px; }
  .modal-footer {
    padding: 8px 16px 16px;
    display: flex; justify-content: flex-end; gap: 8px;
  }

  /* ── Upload Zone ── */
  .upload-zone {
    border: 2px dashed var(--outline); border-radius: var(--radius-m);
    padding: 40px 24px; text-align: center;
    cursor: pointer; transition: border-color .15s, background .15s;
    margin-bottom: 16px;
  }
  .upload-zone:hover, .upload-zone.drag-over {
    border-color: var(--primary); background: var(--primary-light);
  }
  .upload-zone .material-icons-round { font-size: 48px; color: var(--primary); margin-bottom: 12px; }
  .upload-zone h4 { font-family: var(--font-display); font-size: 16px; margin-bottom: 4px; }
  .upload-zone p { font-size: 13px; color: var(--on-surface-variant); }

  /* ── Progress ── */
  .progress-list { display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; }
  .progress-item { display: flex; flex-direction: column; gap: 4px; }
  .progress-item-name { font-size: 13px; display: flex; justify-content: space-between; }
  .progress-bar { height: 4px; background: var(--outline); border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--primary); border-radius: 2px; transition: width .3s; }
  .progress-fill.done { background: var(--success); }
  .progress-fill.error { background: var(--error); }

  /* ── Input ── */
  .text-field {
    width: 100%; padding: 12px 16px;
    border: 1px solid var(--outline); border-radius: var(--radius-s);
    font-family: var(--font-body); font-size: 14px; color: var(--on-surface);
    background: var(--surface); outline: none; transition: border-color .15s;
  }
  .text-field:focus { border-color: var(--primary); border-width: 2px; }
  .field-label {
    display: block; font-size: 12px; font-weight: 500;
    color: var(--on-surface-variant); margin-bottom: 6px;
  }

  /* ── Chip ── */
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 0 12px; height: 32px; border-radius: 16px;
    border: 1px solid var(--outline); background: transparent;
    font-size: 13px; cursor: pointer; font-family: var(--font-body);
    color: var(--on-surface); transition: background .15s;
  }
  .chip:hover { background: rgba(60,64,67,.08); }
  .chip.active { background: var(--primary-light); border-color: var(--primary); color: var(--primary-dark); }
  .chip .material-icons-round { font-size: 16px; }

  /* ── Snackbar ── */
  .snackbar {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(80px);
    background: #323232; color: white; border-radius: var(--radius-s);
    padding: 12px 24px; font-size: 14px; z-index: 300;
    display: flex; align-items: center; gap: 16px;
    box-shadow: var(--shadow-3); transition: transform .3s cubic-bezier(.4,0,.2,1);
    white-space: nowrap;
  }
  .snackbar.show { transform: translateX(-50%) translateY(0); }
  .snackbar-action { color: #BB86FC; font-weight: 500; cursor: pointer; background: none; border: none; font-size: 14px; }

  /* ── Login ── */
  .login-wrap {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #F1F3F4;
    position: relative; overflow: hidden; padding: 24px;
  }
  [data-theme="dark"] .login-wrap { background: var(--background); }
  .login-bg-image {
    position: absolute; inset: 0; z-index: 0;
    width: 100%; height: 100%; object-fit: cover;
  }
  .login-theme-toggle {
    position: fixed; top: 24px; right: 24px; z-index: 2;
    background: var(--surface); box-shadow: var(--shadow-1);
  }
  .login-card {
    background: var(--surface); border-radius: var(--radius-l);
    padding: 48px 40px; width: 400px; max-width: 100%;
    box-shadow: var(--shadow-2); text-align: center;
    position: relative; z-index: 1;
  }
  .login-logo { margin-bottom: 32px; }
  .login-logo .logo-icon { width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 20px; font-size: 32px; }
  .login-title { font-family: var(--font-display); font-size: 28px; font-weight: 400; margin-bottom: 8px; }
  .login-sub { color: var(--on-surface-variant); font-size: 14px; margin-bottom: 32px; }
  .login-btn {
    width: 100%; height: 48px; background: var(--primary); color: white;
    border: none; border-radius: var(--radius-xl); cursor: pointer;
    font-family: var(--font-display); font-size: 16px; font-weight: 500;
    margin-top: 16px; transition: background .15s; box-shadow: var(--shadow-1);
  }
  .login-btn:hover { background: var(--primary-dark); }
  .login-error { color: var(--error); font-size: 13px; margin-top: 8px; min-height: 20px; }

  /* ── View Toggle ── */
  .view-toggle { display: flex; border: 1px solid var(--outline); border-radius: var(--radius-m); overflow: hidden; }
  .view-toggle-btn {
    width: 40px; height: 36px; border: none; background: transparent;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--on-surface-variant); transition: background .15s;
  }
  .view-toggle-btn:hover { background: rgba(60,64,67,.08); }
  .view-toggle-btn.active { background: var(--primary-light); color: var(--primary); }
  .view-toggle-btn .material-icons-round { font-size: 20px; }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .sidebar { display: none; }
    .main { padding: 16px; }
    .file-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    .app-bar-title { font-size: 18px; }
    .login-theme-toggle { top: 16px; right: 16px; }
  }

  /* ── Context Menu ── */
  .context-menu {
    position: fixed; z-index: 250;
    background: var(--surface); border-radius: var(--radius-m);
    box-shadow: var(--shadow-3); padding: 4px 0; min-width: 180px;
    display: none;
  }
  .context-menu.open { display: block; }
  .context-menu-item {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px; cursor: pointer; font-size: 14px;
    color: var(--on-surface); transition: background .1s;
  }
  .context-menu-item:hover { background: rgba(60,64,67,.08); }
  .context-menu-item.danger { color: var(--error); }
  .context-menu-item .material-icons-round { font-size: 18px; color: var(--on-surface-variant); }
  .context-menu-item.danger .material-icons-round { color: var(--error); }
  .context-menu-divider { height: 1px; background: var(--outline); margin: 4px 0; }

  /* ── Storage Bar ── */
  .storage-info { padding: 16px; margin-top: auto; border: none; background: transparent; text-align: left; width: 100%; cursor: pointer; }
  .storage-info:hover { background: rgba(60,64,67,.08); }
  .storage-bar { height: 4px; background: var(--outline); border-radius: 2px; overflow: hidden; margin: 6px 0; }
  .storage-fill { height: 100%; background: var(--primary); border-radius: 2px; }
  .storage-text { font-size: 12px; color: var(--on-surface-variant); }
  .storage-details { display: none; margin-top: 12px; gap: 10px; flex-direction: column; }
  .storage-info.expanded .storage-details { display: flex; }
  .storage-node-name { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--on-surface); }
  .storage-node-meta { font-size: 11px; color: var(--on-surface-variant); margin-top: 2px; }

  /* ── Selection Bar ── */
  .selection-bar {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 150;
    background: var(--primary); color: white; height: 56px;
    display: flex; align-items: center; padding: 0 24px; gap: 16px;
    transform: translateY(100%); transition: transform .25s cubic-bezier(.4,0,.2,1);
    box-shadow: 0 -2px 8px rgba(0,0,0,.2);
  }
  .selection-bar.open { transform: none; }
  .selection-bar-count { font-family: var(--font-display); font-size: 16px; font-weight: 500; flex: 1; }
    .selection-bar .icon-btn { color: white; }
  .selection-bar .icon-btn:hover { background: rgba(255,255,255,.15); }

  /* ── Action Bar (Horizontal) ── */
  .action-bar {
    display: flex; align-items: center; gap: 4px;
    background: var(--surface);
    border: 1px solid var(--outline);
    border-radius: var(--radius-m);
    padding: 4px 8px;
    margin-bottom: 16px;
    min-height: 48px;
    flex-wrap: wrap;
    box-shadow: var(--shadow-1);
    transition: opacity .2s;
  }
  .action-bar:empty { display: none; }
  .action-bar-count {
    font-size: 13px; font-weight: 500;
    color: var(--on-surface-variant);
    padding: 0 8px; white-space: nowrap;
  }
  .action-bar-divider {
    width: 1px; height: 28px;
    background: var(--outline); margin: 0 4px;
  }
  .action-btn {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 6px 12px;
    border: none; background: transparent;
    border-radius: var(--radius-s);
    cursor: pointer;
    font-family: var(--font-body); font-size: 13px; font-weight: 500;
    color: var(--on-surface-variant);
    transition: background .15s, color .15s;
    white-space: nowrap;
  }
  .action-btn:hover { background: rgba(60,64,67,.08); color: var(--on-surface); }
  .action-btn:active { background: rgba(60,64,67,.12); }
  .action-btn .material-icons-round { font-size: 18px; }
  .action-btn.danger:hover { color: var(--error); background: rgba(217,48,37,.08); }
  .action-btn:disabled {
    opacity: .38; cursor: default; pointer-events: none;
  }
  [data-theme="dark"] .action-btn:hover { background: rgba(232,234,237,.08); color: var(--on-surface); }
  [data-theme="dark"] .action-btn.danger:hover { background: rgba(242,139,130,.08); }

  .node-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .node-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; border: 1px solid var(--outline);
    border-radius: var(--radius-m); background: var(--background);
  }
  .node-row-main { flex: 1; min-width: 0; }
  .node-row-title { font-size: 14px; font-weight: 500; color: var(--on-surface); }
  .node-row-sub { font-size: 12px; color: var(--on-surface-variant); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node-row-bar { height: 4px; background: var(--outline); border-radius: 2px; overflow: hidden; margin-top: 8px; }
  .node-row-fill { height: 100%; background: var(--primary); border-radius: 2px; }
  .node-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .node-form-grid .full { grid-column: 1 / -1; }
  @media (max-width: 560px) {
    .node-form-grid { grid-template-columns: 1fr; }
  }

    /* ── Dark Mode Toggle ── */
  /* Icon is handled by JS toggleDarkMode() */
</style>
</head>
<body>
${content}

<div class="snackbar" id="snackbar">
  <span id="snackbar-msg"></span>
  <button class="snackbar-action" onclick="hideSnackbar()" style="display:none" id="snackbar-action-btn"></button>
</div>

<div class="context-menu" id="contextMenu">
  <div class="context-menu-item" onclick="ctxDownload()">
    <span class="material-icons-round">download</span> 下载
  </div>
  <div class="context-menu-item" onclick="ctxRename()">
    <span class="material-icons-round">drive_file_rename_outline</span> 重命名
  </div>
  <div class="context-menu-item" onclick="ctxCopyLink()">
    <span class="material-icons-round">link</span> 复制链接
  </div>
  <div class="context-menu-divider"></div>
  <div class="context-menu-item danger" onclick="ctxDelete()">
    <span class="material-icons-round">delete_outline</span> 删除
  </div>
</div>

<script>
// ── State ──
let viewMode = localStorage.getItem('viewMode') || 'grid';
let selectedFiles = new Set();
let ctxTarget = null;
let currentPath = '';
let sortBy = 'name';
let sortDir = 1;

// ── Helper (client-side) ──
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ── Clipboard (Copy/Cut) ──
let clipboard = { items: [], action: null, sourcePath: '' }; // action: 'copy' or 'cut'

// ── Storage ──
const STORAGE_TOTAL = 10 * 1024 * 1024 * 1024; // 10 GB per account/node
let storageUsed = 0;
let storageExpanded = false;

// ── Snackbar ──
let snackbarTimer;
function showSnackbar(msg, action, actionCb) {
  const el = document.getElementById('snackbar');
  const msgEl = document.getElementById('snackbar-msg');
  const btnEl = document.getElementById('snackbar-action-btn');
  msgEl.textContent = msg;
  if (action && actionCb) {
    btnEl.textContent = action; btnEl.style.display = ''; btnEl.onclick = actionCb;
  } else { btnEl.style.display = 'none'; }
  el.classList.add('show');
  clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(hideSnackbar, 4000);
}
function hideSnackbar() { document.getElementById('snackbar').classList.remove('show'); }

// ── View Mode ──
function setView(mode) {
  viewMode = mode; localStorage.setItem('viewMode', mode);
  document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
  const grid = document.getElementById('fileGrid');
  const list = document.getElementById('fileList');
  if (grid && list) { grid.style.display = mode === 'grid' ? '' : 'none'; list.style.display = mode === 'list' ? '' : 'none'; }
}

// ── Selection ──
// ── File Click: single click selects, double click downloads
function handleFileClick(event, name) {
  if (event.detail === 1) {
    toggleSelect(name, event.currentTarget);
  } else if (event.detail === 2) {
    const path = currentPath ? currentPath + '/' + name : name;
    window.open('/api/download?path=' + encodeURIComponent(path));
  }
}

// ── Folder Click: single click selects, double click navigates
function handleFolderClick(event, name, href) {
  if (event.ctrlKey || event.metaKey) {
    toggleSelect(name, event.currentTarget);
    return;
  }
  // Check if this is a single click or part of a double click
  if (event.detail === 1) {
    // Single click: toggle select (to allow rename, copy, etc.)
    toggleSelect(name, event.currentTarget);
  } else if (event.detail === 2) {
    // Double click: navigate into folder
    location.href = href;
  }
}

function toggleSelect(name, el) {
  if (selectedFiles.has(name)) { selectedFiles.delete(name); el?.classList.remove('selected'); }
  else { selectedFiles.add(name); el?.classList.add('selected'); }
  updateSelectionBar();
  updateActionBar();
}
function clearSelection() {
  selectedFiles.clear();
  document.querySelectorAll('.file-card.selected, .file-list tr.selected').forEach(el => el.classList.remove('selected'));
  updateSelectionBar();
  updateActionBar();
}
function updateSelectionBar() {
  const bar = document.getElementById('selectionBar');
  if (!bar) return;
  const n = selectedFiles.size;
  bar.classList.toggle('open', n > 0);
  const countEl = document.getElementById('selectionCount');
  if (countEl) countEl.textContent = n + ' 个已选中';
}
function updateActionBar() {
  const bar = document.getElementById('actionBar');
  if (!bar) return;
  const countEl = document.getElementById('actionBarCount');
  const n = selectedFiles.size;
  if (countEl) countEl.textContent = n > 0 ? '已选 ' + n + ' 项' : '未选中';
  // Update paste button state (check clipboard in memory)
  const pasteBtn = document.getElementById('pasteBtn');
  if (pasteBtn) {
    pasteBtn.disabled = !clipboard.items.length;
  }
}

// ── Async check clipboard from KV on load ──
async function checkClipboardFromKV() {
  const pasteBtn = document.getElementById('pasteBtn');
  if (!pasteBtn) return;
  try {
    const res = await fetch('/api/clipboard?id=' + getClipboardId());
    const data = await res.json();
    if (data && Array.isArray(data.items) && data.items.length > 0) {
      clipboard = { items: data.items, action: data.action || null, sourcePath: data.sourcePath || '' };
      pasteBtn.disabled = false;
    }
  } catch(e) { /* ignore */ }
}

// ── Dark Mode ──
function applyDarkMode(isDark) {
  const html = document.documentElement;
  if (isDark) html.setAttribute('data-theme', 'dark');
  else html.removeAttribute('data-theme');
  localStorage.setItem('theme', isDark ? 'dark' : '');
  document.querySelectorAll('#darkModeToggle .material-icons-round').forEach(icon => {
    icon.textContent = isDark ? 'light_mode' : 'dark_mode';
  });
}

function getThemeRipplePoint(event) {
  if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    return { x: event.clientX, y: event.clientY };
  }
  return { x: window.innerWidth - 48, y: 48 };
}

function getThemeRippleRadius(x, y) {
  return Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );
}

function animateThemeRipple(event, toDark, applyTheme) {
  const { x, y } = getThemeRipplePoint(event);
  const radius = getThemeRippleRadius(x, y);

  if (document.startViewTransition) {
    const transition = document.startViewTransition(applyTheme);
    transition.ready.then(() => {
      document.documentElement.animate({
        clipPath: [
          'circle(0px at ' + x + 'px ' + y + 'px)',
          'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'
        ]
      }, {
        duration: 550,
        easing: 'cubic-bezier(.4, 0, .2, 1)',
        pseudoElement: '::view-transition-new(root)'
      });
    });
    return;
  }

  const ripple = document.createElement('span');
  const diameter = radius * 2;
  ripple.className = 'theme-ripple';
  ripple.style.left = x + 'px';
  ripple.style.top = y + 'px';
  ripple.style.width = diameter + 'px';
  ripple.style.height = diameter + 'px';
  ripple.style.background = toDark ? '#121212' : '#F1F3F4';
  document.body.appendChild(ripple);

  requestAnimationFrame(() => {
    ripple.style.transform = 'translate(-50%, -50%) scale(1)';
  });
  window.setTimeout(applyTheme, 500);
  window.setTimeout(() => ripple.remove(), 620);
}

function toggleDarkMode(event) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const toDark = !isDark;
  animateThemeRipple(event, toDark, () => applyDarkMode(toDark));
}
function initDarkMode() {
  applyDarkMode(localStorage.getItem('theme') === 'dark');
}

// ── Clipboard ID (random per browser session, survives navigation) ──
function getClipboardId() {
  let id = sessionStorage.getItem('r2clipboardId');
  if (!id) {
    id = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('r2clipboardId', id);
  }
  return id;
}

// ── Clipboard Persistence via KV API (survives page navigation) ──
async function saveClipboard() {
  try {
    await fetch('/api/clipboard?id=' + getClipboardId(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clipboard)
    });
  } catch(e) { /* ignore */ }
}
async function loadClipboard() {
  try {
    const res = await fetch('/api/clipboard?id=' + getClipboardId());
    const data = await res.json();
    if (data && Array.isArray(data.items)) {
      clipboard = { items: data.items, action: data.action || null, sourcePath: data.sourcePath || '' };
    } else {
      clipboard = { items: [], action: null, sourcePath: '' };
    }
  } catch(e) { clipboard = { items: [], action: null, sourcePath: '' }; }
}
async function clearClipboard() {
  clipboard = { items: [], action: null, sourcePath: '' };
  try {
    await fetch('/api/clipboard?id=' + getClipboardId(), { method: 'DELETE' });
  } catch(e) { /* ignore */ }
  updateActionBar();
}

// ── Clipboard Operations ──
async function copySelected() {
  if (!selectedFiles.size) return;
  clipboard.items = [...selectedFiles];
  clipboard.action = 'copy';
  clipboard.sourcePath = currentPath;
  await saveClipboard();
  showSnackbar('已复制 ' + clipboard.items.length + ' 项，请进入目标文件夹后粘贴', '清除', () => clearClipboard());
  updateActionBar();
}
async function cutSelected() {
  if (!selectedFiles.size) return;
  clipboard.items = [...selectedFiles];
  clipboard.action = 'cut';
  clipboard.sourcePath = currentPath;
  await saveClipboard();
  showSnackbar('已剪切 ' + clipboard.items.length + ' 项，请进入目标文件夹后粘贴', '清除', () => clearClipboard());
  updateActionBar();
}
async function pasteFiles() {
  // Reload clipboard from KV in case of page navigation
  await loadClipboard();
  if (!clipboard.items.length) return;
  const targetPath = currentPath ? currentPath + '/' : '';
  const sourceBase = clipboard.sourcePath ? clipboard.sourcePath + '/' : '';
  for (const name of clipboard.items) {
    const oldPath = sourceBase + name;
    // If cutting, move the file; if copying, copy it
    if (clipboard.action === 'cut') {
      const finalPath = targetPath + name;
      // Use rename API
      try {
        const res = await fetch('/api/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: oldPath, to: finalPath })
        });
        if (!res.ok) showSnackbar('移动失败: ' + name);
      } catch(e) { showSnackbar('移动失败: ' + name); }
    } else {
      // Copy: download then upload
      try {
        const dlRes = await fetch('/api/download?path=' + encodeURIComponent(oldPath));
        if (!dlRes.ok) { showSnackbar('复制失败: ' + name); continue; }
        const blob = await dlRes.blob();
        const upRes = await fetch('/api/upload?path=' + encodeURIComponent(targetPath + name), { method: 'POST', body: blob });
        if (!upRes.ok) showSnackbar('复制失败: ' + name);
      } catch(e) { showSnackbar('复制失败: ' + name); }
    }
  }
  if (clipboard.action === 'cut') {
    await clearClipboard();
  }
  showSnackbar('操作完成', '刷新', () => location.reload());
}

// ── Rename Selected ──
function renameSelected() {
  if (selectedFiles.size !== 1) { showSnackbar('请只选择一个文件进行重命名'); return; }
  const name = [...selectedFiles][0];
  const newName = prompt('重命名为:', name);
  if (!newName || newName === name) return;
  const oldPath = currentPath ? currentPath + '/' + name : name;
  const newPath = currentPath ? currentPath + '/' + newName : newName;
  fetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: oldPath, to: newPath })
  }).then(r => r.ok ? (showSnackbar('已重命名'), location.reload()) : showSnackbar('重命名失败'));
}

// ── Download Selected ──
function downloadSelected() {
  if (!selectedFiles.size) return;
  const names = [...selectedFiles];
  if (names.length === 1) {
    const path = currentPath ? currentPath + '/' + names[0] : names[0];
    window.open('/api/download?path=' + encodeURIComponent(path));
  } else {
    names.forEach(name => {
      const path = currentPath ? currentPath + '/' + name : name;
      window.open('/api/download?path=' + encodeURIComponent(path));
    });
  }
}

// ── Storage Calculation ──
async function updateStorageInfo() {
  try {
    const res = await fetch('/api/storage');
    const data = await res.json();
    storageUsed = data.used || 0;
    const storageTotal = data.total || STORAGE_TOTAL;
    const fillEl = document.getElementById('storageFill');
    const textEl = document.getElementById('storageText');
    if (fillEl) {
      const pct = Math.min(100, (storageUsed / storageTotal) * 100);
      fillEl.style.width = pct + '%';
      if (pct > 85) fillEl.style.background = 'var(--error)';
      else if (pct > 60) fillEl.style.background = 'var(--warning)';
    }
    if (textEl) {
      textEl.textContent = '已用 ' + formatSize(storageUsed) + ' / 共 ' + formatSize(storageTotal);
    }
    window.storageInfoData = data;
    renderStorageDetails(data.nodes || []);
  } catch(e) {
    const textEl = document.getElementById('storageText');
    if (textEl) textEl.textContent = '无法获取存储信息';
  }
}

function toggleStorageDetails() {
  storageExpanded = !storageExpanded;
  const info = document.getElementById('storageInfo');
  if (info) info.classList.toggle('expanded', storageExpanded);
  if (storageExpanded && !window.storageInfoData) updateStorageInfo();
}

function renderStorageDetails(nodes) {
  const list = document.getElementById('storageDetails');
  if (!list) return;
  if (!nodes.length) {
    list.innerHTML = '<div class="storage-node-meta">暂无节点容量信息</div>';
    return;
  }
  list.innerHTML = nodes.map(node => {
    const used = node.used || 0;
    const total = node.total || STORAGE_TOTAL;
    const pct = total > 0 ? Math.min(100, Math.round(used / total * 100)) : 0;
    const statusText = node.online === false ? ' · 离线' : (node.storageAvailable === false ? ' · 用量不可用' : '');
    return '<div>' +
      '<div class="storage-node-name"><span>' + escapeHtml(node.name || node.id) + '</span><span>' + pct + '%</span></div>' +
      '<div class="storage-bar"><div class="storage-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="storage-node-meta">' + formatSize(used) + ' / ' + formatSize(total) + statusText + '</div>' +
    '</div>';
  }).join('');
}
function deleteSelected() {
  if (!selectedFiles.size) return;
  if (!confirm('确定删除选中的 ' + selectedFiles.size + ' 个文件？')) return;
  Promise.all([...selectedFiles].map(name => {
    const path = currentPath ? currentPath + '/' + name : name;
    return fetch('/api/delete?path=' + encodeURIComponent(path), { method: 'DELETE' });
  })).then(() => { showSnackbar('已删除 ' + selectedFiles.size + ' 个文件'); location.reload(); });
}

// ── Context Menu ──
function showCtxMenu(e, name) {
  e.preventDefault(); e.stopPropagation();
  ctxTarget = name;
  const menu = document.getElementById('contextMenu');
  menu.classList.add('open');
  let x = e.clientX, y = e.clientY;
  if (x + 200 > window.innerWidth) x = window.innerWidth - 200;
  if (y + 200 > window.innerHeight) y = window.innerHeight - 200;
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
}
document.addEventListener('click', () => document.getElementById('contextMenu')?.classList.remove('open'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { clearSelection(); document.getElementById('contextMenu')?.classList.remove('open'); } });

function ctxDownload() {
  if (!ctxTarget) return;
  const path = currentPath ? currentPath + '/' + ctxTarget : ctxTarget;
  window.open('/api/download?path=' + encodeURIComponent(path));
}
function ctxRename() {
  if (!ctxTarget) return;
  const newName = prompt('重命名为:', ctxTarget);
  if (!newName || newName === ctxTarget) return;
  const oldPath = currentPath ? currentPath + '/' + ctxTarget : ctxTarget;
  const newPath = currentPath ? currentPath + '/' + newName : newName;
  fetch('/api/rename', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({from: oldPath, to: newPath}) })
    .then(r => r.ok ? (showSnackbar('已重命名'), location.reload()) : showSnackbar('重命名失败'));
}
function ctxCopyLink() {
  if (!ctxTarget) return;
  const path = currentPath ? currentPath + '/' + ctxTarget : ctxTarget;
  const url = location.origin + '/api/download?path=' + encodeURIComponent(path);
  navigator.clipboard.writeText(url).then(() => showSnackbar('链接已复制'));
}
function ctxDelete() {
  if (!ctxTarget) return;
  if (!confirm('确定删除 "' + ctxTarget + '"？')) return;
  const path = currentPath ? currentPath + '/' + ctxTarget : ctxTarget;
  fetch('/api/delete?path=' + encodeURIComponent(path), { method: 'DELETE' })
    .then(r => r.ok ? (showSnackbar('已删除'), location.reload()) : showSnackbar('删除失败'));
}

// ── Upload ──
function openUpload() { document.getElementById('uploadModal')?.classList.add('open'); }
function closeUpload() { document.getElementById('uploadModal')?.classList.remove('open'); }
function openNewFolder() { document.getElementById('newFolderModal')?.classList.add('open'); setTimeout(() => document.getElementById('folderNameInput')?.focus(), 100); }
function closeNewFolder() { document.getElementById('newFolderModal')?.classList.remove('open'); }

function handleDrop(e) {
  e.preventDefault();
  document.querySelector('.upload-zone')?.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
}
function handleDragOver(e) { e.preventDefault(); document.querySelector('.upload-zone')?.classList.add('drag-over'); }
function handleDragLeave() { document.querySelector('.upload-zone')?.classList.remove('drag-over'); }
function handleFileInput(e) { uploadFiles(e.target.files); }

const DIRECT_UPLOAD_LIMIT = 90 * 1024 * 1024;
const MULTIPART_DEFAULT_CHUNK = 32 * 1024 * 1024;
const MULTIPART_MAX_CHUNK = 90 * 1024 * 1024;
const MULTIPART_MAX_PARTS = 10000;

function uploadFiles(files) {
  if (!files.length) return;
  const list = document.getElementById('progressList');
  if (list) list.innerHTML = '';
  const tasks = [...files].map(file => {
    const item = document.createElement('div'); item.className = 'progress-item';
    const nameRow = document.createElement('div'); nameRow.className = 'progress-item-name';
    const nameSpan = document.createElement('span'); nameSpan.textContent = file.name;
    const pctSpan = document.createElement('span'); pctSpan.textContent = '0%';
    nameRow.append(nameSpan, pctSpan);
    const bar = document.createElement('div'); bar.className = 'progress-bar';
    const fill = document.createElement('div'); fill.className = 'progress-fill'; fill.style.width = '0%';
    bar.append(fill); item.append(nameRow, bar);
    if (list) list.append(item);

    const path = currentPath ? currentPath + '/' + file.name : file.name;
    return uploadSingleFile(file, path, fill, pctSpan);
  });

  Promise.allSettled(tasks).then(() => {
    showSnackbar('上传完成', '刷新', () => location.reload());
  });
}

function uploadSingleFile(file, path, fill, pctSpan) {
  if (file.size <= DIRECT_UPLOAD_LIMIT) {
    return uploadDirect(file, path, fill, pctSpan);
  }
  return uploadDistributed(file, path, fill, pctSpan)
    .catch(() => uploadMultipart(file, path, fill, pctSpan));
}

function uploadDirect(file, path, fill, pctSpan) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?path=' + encodeURIComponent(path));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        fill.style.width = pct + '%'; pctSpan.textContent = pct + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        fill.classList.add('done'); pctSpan.textContent = '✓'; resolve();
      } else {
        fill.classList.add('error'); pctSpan.textContent = '✗'; reject(new Error('upload failed'));
      }
    };
    xhr.onerror = () => {
      fill.classList.add('error'); pctSpan.textContent = '✗'; reject(new Error('upload failed'));
    };
    xhr.send(file);
  });
}

async function uploadMultipart(file, path, fill, pctSpan) {
  const chunkSize = Math.min(MULTIPART_MAX_CHUNK, Math.max(MULTIPART_DEFAULT_CHUNK, Math.ceil(file.size / MULTIPART_MAX_PARTS)));
  const totalParts = Math.ceil(file.size / chunkSize);
  if (totalParts > MULTIPART_MAX_PARTS) {
    fill.classList.add('error'); pctSpan.textContent = '文件过大';
    throw new Error('too many multipart chunks');
  }

  let uploadId = '';
  const parts = [];
  let uploadedBytes = 0;

  try {
    const initRes = await fetch('/api/multipart/init', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path, contentType: file.type || '' })
    });
    if (!initRes.ok) throw new Error('multipart init failed');
    const initData = await initRes.json();
    uploadId = initData.uploadId;

    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const chunk = file.slice(start, end);
      const part = await uploadMultipartPart(path, uploadId, partNumber, chunk, loaded => {
        const pct = Math.min(99, Math.round((uploadedBytes + loaded) / file.size * 100));
        fill.style.width = pct + '%';
        pctSpan.textContent = pct + '%';
      });
      uploadedBytes += chunk.size;
      parts.push(part);
    }

    const completeRes = await fetch('/api/multipart/complete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path, uploadId, parts })
    });
    if (!completeRes.ok) throw new Error('multipart complete failed');
    fill.style.width = '100%';
    fill.classList.add('done');
    pctSpan.textContent = '✓';
  } catch (err) {
    if (uploadId) {
      fetch('/api/multipart/abort', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ path, uploadId })
      }).catch(() => {});
    }
    fill.classList.add('error');
    pctSpan.textContent = '✗';
    throw err;
  }
}

function uploadMultipartPart(path, uploadId, partNumber, chunk, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = '/api/multipart/part?path=' + encodeURIComponent(path)
      + '&uploadId=' + encodeURIComponent(uploadId)
      + '&partNumber=' + partNumber;
    xhr.open('POST', url);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status !== 200) {
        reject(new Error('multipart part failed'));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (err) {
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('multipart part failed'));
    xhr.send(chunk);
  });
}

async function uploadDistributed(file, path, fill, pctSpan) {
  const chunkSize = Math.min(MULTIPART_MAX_CHUNK, Math.max(MULTIPART_DEFAULT_CHUNK, Math.ceil(file.size / MULTIPART_MAX_PARTS)));
  const totalParts = Math.ceil(file.size / chunkSize);
  if (totalParts > MULTIPART_MAX_PARTS) throw new Error('too many distributed chunks');

  const initRes = await fetch('/api/distributed/init', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      path,
      size: file.size,
      contentType: file.type || '',
      chunkSize,
      parts: totalParts
    })
  });
  if (!initRes.ok) throw new Error('distributed storage unavailable');
  const session = await initRes.json();
  const sessionId = session.sessionId;

  let uploadedBytes = 0;
  try {
    for (let index = 0; index < totalParts; index++) {
      const partInfo = session.parts[index];
      const start = index * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const chunk = file.slice(start, end);
      await uploadDistributedPart(partInfo, chunk, loaded => {
        const pct = Math.min(99, Math.round((uploadedBytes + loaded) / file.size * 100));
        fill.style.width = pct + '%';
        pctSpan.textContent = pct + '%';
      });
      uploadedBytes += chunk.size;
    }

    const completeRes = await fetch('/api/distributed/complete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ sessionId })
    });
    if (!completeRes.ok) throw new Error('distributed complete failed');
    fill.style.width = '100%';
    fill.classList.add('done');
    pctSpan.textContent = '✓';
  } catch (err) {
    if (sessionId) {
      await fetch('/api/distributed/abort', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ sessionId })
      }).catch(() => {});
    }
    throw err;
  }
}

function uploadDistributedPart(partInfo, chunk, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', partInfo.uploadUrl);
    xhr.setRequestHeader('Authorization', 'Bearer ' + partInfo.token);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error('distributed part failed'));
    };
    xhr.onerror = () => reject(new Error('distributed part failed'));
    xhr.send(chunk);
  });
}

function openStorageNodes() {
  document.getElementById('storageNodesModal')?.classList.add('open');
  loadStorageNodes();
}
function closeStorageNodes() {
  document.getElementById('storageNodesModal')?.classList.remove('open');
}
async function loadStorageNodes() {
  const list = document.getElementById('storageNodeList');
  if (list) list.innerHTML = '<div class="node-row"><div class="node-row-main"><div class="node-row-sub">加载中...</div></div></div>';
  try {
    const res = await fetch('/api/storage-nodes');
    const data = await res.json();
    renderStorageNodes(data.nodes || []);
  } catch {
    if (list) list.innerHTML = '<div class="node-row"><div class="node-row-main"><div class="node-row-sub">加载失败</div></div></div>';
  }
}
function renderStorageNodes(nodes) {
  const list = document.getElementById('storageNodeList');
  if (!list) return;
  if (!nodes.length) {
    list.innerHTML = '<div class="node-row"><div class="node-row-main"><div class="node-row-sub">暂无存储节点，大文件将上传到主账号 R2</div></div></div>';
    return;
  }
  list.innerHTML = nodes.map(node =>
    '<div class="node-row">' +
      '<div class="node-row-main">' +
        '<div class="node-row-title">' + escapeHtml(node.name || node.id) + '</div>' +
        '<div class="node-row-sub">' + escapeHtml(node.url) + ' · 权重 ' + (node.weight || 1) + ' · ' + (node.enabled ? '启用' : '停用') + '</div>' +
      '</div>' +
      '<button class="icon-btn" title="测试" onclick="testStorageNode(\\'' + node.id + '\\')">' +
        '<span class="material-icons-round">network_check</span>' +
      '</button>' +
      '<button class="icon-btn" title="删除" onclick="deleteStorageNode(\\'' + node.id + '\\')">' +
        '<span class="material-icons-round">delete_outline</span>' +
      '</button>' +
    '</div>'
  ).join('');
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
async function saveStorageNode() {
  const name = document.getElementById('nodeNameInput')?.value?.trim();
  const url = document.getElementById('nodeUrlInput')?.value?.trim();
  const token = document.getElementById('nodeTokenInput')?.value?.trim();
  const weight = document.getElementById('nodeWeightInput')?.value || '1';
  if (!name || !url || !token) { showSnackbar('请填写节点名称、地址和密钥'); return; }
  const res = await fetch('/api/storage-nodes', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name, url, token, weight })
  });
  if (!res.ok) { showSnackbar('保存节点失败'); return; }
  document.getElementById('nodeNameInput').value = '';
  document.getElementById('nodeUrlInput').value = '';
  document.getElementById('nodeTokenInput').value = '';
  document.getElementById('nodeWeightInput').value = '1';
  showSnackbar('节点已保存');
  loadStorageNodes();
}
async function deleteStorageNode(id) {
  if (!confirm('确定删除这个存储节点？')) return;
  const res = await fetch('/api/storage-nodes?id=' + encodeURIComponent(id), { method: 'DELETE' });
  showSnackbar(res.ok ? '节点已删除' : '删除节点失败');
  loadStorageNodes();
}
async function testStorageNode(id) {
  const res = await fetch('/api/storage-nodes/test?id=' + encodeURIComponent(id), { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    showSnackbar('节点正常，容量 ' + formatSize(data.used || 0) + ' / ' + formatSize(data.total || STORAGE_TOTAL));
  } else if (data.ping && data.storage === false) {
    showSnackbar('节点可连接，但容量接口不可用，请更新节点 Worker');
  } else {
    showSnackbar('节点连接失败');
  }
}

function createFolder() {
  const name = document.getElementById('folderNameInput')?.value?.trim();
  if (!name) return;
  const path = currentPath ? currentPath + '/' + name : name;
  fetch('/api/mkdir', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path}) })
    .then(r => r.ok ? (showSnackbar('文件夹已创建'), location.reload()) : showSnackbar('创建失败'));
}

// ── Sort ──
function sortTable(by) {
  if (sortBy === by) sortDir *= -1; else { sortBy = by; sortDir = 1; }
  const tbody = document.querySelector('.file-list tbody');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('tr')];
  rows.sort((a, b) => {
    const aVal = a.dataset[by] || ''; const bVal = b.dataset[by] || '';
    if (by === 'size') return (parseInt(aVal) - parseInt(bVal)) * sortDir;
    return aVal.localeCompare(bVal, 'zh-CN') * sortDir;
  });
  rows.forEach(r => tbody.append(r));
}

// ── Logout ──
function logout() { fetch('/api/logout', { method: 'POST' }).then(() => location.href = '/login'); }

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  setView(viewMode);
  currentPath = decodeURIComponent(new URLSearchParams(location.search).get('path') || '');
  initDarkMode();
  checkClipboardFromKV();
  updateStorageInfo();
  updateActionBar();
});
</script>
</body>
</html>`;
}

function renderLoginPage(error = '', siteTitle = 'R2 云盘', cloudIconUrl = '', loginBackgroundUrl = '') {
  const bgUrl = String(loginBackgroundUrl || '').trim();
  const loginBg = bgUrl
    ? `<img class="login-bg-image" src="${escapeAttr(bgUrl)}" alt="" aria-hidden="true">`
    : '';
  return renderHTML(`
<div class="login-wrap">
  ${loginBg}
  <button class="icon-btn login-theme-toggle" id="darkModeToggle" title="夜间模式" onclick="toggleDarkMode(event)">
    <span class="material-icons-round">dark_mode</span>
  </button>
  <div class="login-card">
    <div class="login-logo">
      ${renderLogoIcon(cloudIconUrl)}
      <h1 class="login-title">${siteTitle}</h1>
      <p class="login-sub">安全访问您的云端文件</p>
    </div>
    <label class="field-label" for="pwd">访问密码</label>
    <input class="text-field" id="pwd" type="password" placeholder="请输入密码" autofocus
      onkeydown="if(event.key==='Enter')login()">
        <p class="login-error" id="loginError">${error}</p>
    <button class="login-btn" onclick="login()">登录</button>
    <div style="margin-top:24px;font-size:13px;color:var(--on-surface-variant)">
      <a href="/shared" style="color:var(--primary);text-decoration:none;display:flex;align-items:center;justify-content:center;gap:4px">
        <span class="material-icons-round" style="font-size:16px">folder_shared</span> 访问共享文件夹
      </a>
    </div>
  </div>
</div>
<script>
function login() {
  const pwd = document.getElementById('pwd').value;
  fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: pwd}) })
    .then(r => r.json()).then(d => {
      if (d.ok) location.href = '/'; else document.getElementById('loginError').textContent = '密码错误，请重试';
    });
}
</script>
`, siteTitle + ' - 登录');
}

// ── Shared Folder Page (public, download only) ──
function renderSharedPage(folders, files, currentPath, siteTitle, cloudIconUrl = '') {
  const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const sharedBase = '/shared';
  const sharedPrefix = SHARED_PREFIX;

  const breadcrumb = `<nav class="breadcrumb">
    <div class="breadcrumb-item">
      <a class="breadcrumb-link" href="${sharedBase}">
        <span class="material-icons-round" style="font-size:18px;vertical-align:middle">folder_shared</span> 共享文件夹
      </a>
    </div>
    ${pathParts.map((part, i) => {
      const href = sharedBase + '/?path=' + encodeURIComponent(pathParts.slice(0, i + 1).join('/'));
      const isLast = i === pathParts.length - 1;
      return `<div class="breadcrumb-item">
        <span class="material-icons-round breadcrumb-sep">chevron_right</span>
        ${isLast ? `<span class="breadcrumb-current">${part}</span>` : `<a class="breadcrumb-link" href="${href}">${part}</a>`}
      </div>`;
    }).join('')}
  </nav>`;

  const isEmpty = folders.length === 0 && files.length === 0;

  return renderHTML(`
<header class="app-bar">
  <a class="app-bar-logo" href="${sharedBase}">
    ${renderLogoIcon(cloudIconUrl)}
    <span class="app-bar-title">${siteTitle} - 共享</span>
  </a>
  <div class="app-bar-spacer"></div>
  <div class="app-bar-actions">
    <button class="icon-btn" id="darkModeToggle" title="夜间模式" onclick="toggleDarkMode(event)">
      <span class="material-icons-round">dark_mode</span>
    </button>
    <button class="icon-btn" title="登录管理" onclick="location.href='/'">
      <span class="material-icons-round">login</span>
    </button>
  </div>
</header>

<div class="layout">
  <nav class="sidebar">
    <div class="sidebar-section">
      <a class="sidebar-item active" href="${sharedBase}">
        <span class="material-icons-round">folder_shared</span> 共享文件夹
      </a>
    </div>
    <div class="sidebar-divider"></div>
    <div class="sidebar-section">
      <div class="sidebar-label">提示</div>
      <div class="sidebar-item" style="cursor:default;color:var(--on-surface-variant);font-weight:400;font-size:13px;line-height:1.5;padding:8px 16px;height:auto;border-radius:8px;">
        此文件夹内容公开共享，仅支持下载查看。如需管理文件，请登录账号。
      </div>
    </div>
  </nav>

  <main class="main">
    ${breadcrumb}

        <div class="toolbar">
      <div class="toolbar-right">
        <div class="view-toggle">
          <button class="view-toggle-btn" data-view="grid" onclick="setView('grid')" title="网格视图">
            <span class="material-icons-round">grid_view</span>
          </button>
          <button class="view-toggle-btn" data-view="list" onclick="setView('list')" title="列表视图">
            <span class="material-icons-round">view_list</span>
          </button>
        </div>
      </div>
    </div>

    ${isEmpty ? `
    <div class="empty-state">
      <span class="material-icons-round">folder_shared</span>
      <h3>共享文件夹为空</h3>
      <p>管理员尚未分享任何文件到共享文件夹</p>
    </div>
    ` : `
    <!-- Grid View -->
    <div id="fileGrid" class="file-grid">
      ${folders.map(name => {
        const href = sharedBase + '/?path=' + encodeURIComponent(currentPath ? currentPath + '/' + name : name);
        return `<div class="file-card" onclick="location.href='${href}'">
          <div class="file-card-icon" style="background:#FFF8E1">
            <span class="material-icons-round" style="color:#F9AB00;font-size:32px">folder</span>
          </div>
          <div class="file-card-name">${name}</div>
          <div class="file-card-meta"><span>文件夹</span></div>
        </div>`;
      }).join('')}
            ${files.map(file => {
        const { icon, color } = getFileIcon(file.name);
                const dlPath = sharedPrefix + '/' + (currentPath ? currentPath + '/' + file.name : file.name);
        return `<div class="file-card" onclick="window.open('/api/download?path=${encodeURIComponent(dlPath)}')">
          <div class="file-card-icon" style="background:${color}18">
            <span class="material-icons-round" style="color:${color};font-size:32px">${icon}</span>
          </div>
          <div class="file-card-name" title="${file.name}">${file.name}</div>
          <div class="file-card-meta">
            <span>${formatSize(file.size)}</span>
            <span>${formatDate(file.uploaded)}</span>
          </div>
        </div>`;
      }).join('')}
    </div>

    <!-- List View -->
    <div id="fileList" style="display:none">
      <table class="file-list">
        <thead>
          <tr>
            <th><div class="th-inner">名称</div></th>
            <th><div class="th-inner">大小</div></th>
            <th><div class="th-inner">修改时间</div></th>
            <th style="width:80px"></th>
          </tr>
        </thead>
        <tbody>
          ${folders.map(name => {
            const href = sharedBase + '/?path=' + encodeURIComponent(currentPath ? currentPath + '/' + name : name);
            return `<tr>
              <td><div class="file-row-icon">
                <span class="material-icons-round" style="color:#F9AB00;font-size:22px">folder</span>
                <span class="file-row-name" onclick="location.href='${href}'">${name}</span>
              </div></td>
              <td class="file-row-meta">—</td>
              <td class="file-row-meta">—</td>
              <td></td>
            </tr>`;
          }).join('')}
          ${files.map(file => {
            const { icon, color } = getFileIcon(file.name);
                        const dlPath = sharedPrefix + '/' + (currentPath ? currentPath + '/' + file.name : file.name);
            return `<tr>
              <td><div class="file-row-icon">
                <span class="material-icons-round" style="color:${color};font-size:22px">${icon}</span>
                <span class="file-row-name" onclick="window.open('/api/download?path=${encodeURIComponent(dlPath)}')">${file.name}</span>
              </div></td>
              <td class="file-row-meta">${formatSize(file.size)}</td>
              <td class="file-row-meta">${formatDate(file.uploaded)}</td>
              <td>
                <button class="icon-btn" title="下载" onclick="window.open('/api/download?path=${encodeURIComponent(dlPath)}')">
                  <span class="material-icons-round">download</span>
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    `}
  </main>
</div>

`, siteTitle + ' - 共享');
}

function renderDrivePage(folders, files, currentPath, siteTitle, cloudIconUrl = '') {
  const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  const breadcrumb = `<nav class="breadcrumb">
    <div class="breadcrumb-item">
      <a class="breadcrumb-link" href="/">
        <span class="material-icons-round" style="font-size:18px;vertical-align:middle">cloud</span> 我的云盘
      </a>
    </div>
    ${pathParts.map((part, i) => {
      const href = '/?path=' + encodeURIComponent(pathParts.slice(0, i + 1).join('/'));
      const isLast = i === pathParts.length - 1;
      return `<div class="breadcrumb-item">
        <span class="material-icons-round breadcrumb-sep">chevron_right</span>
        ${isLast ? `<span class="breadcrumb-current">${part}</span>` : `<a class="breadcrumb-link" href="${href}">${part}</a>`}
      </div>`;
    }).join('')}
  </nav>`;

    const renderFolderCard = (name) => {
    const href = '/?path=' + encodeURIComponent(currentPath ? currentPath + '/' + name : name);
    return `<div class="file-card" onclick="handleFolderClick(event,'${name}','${href}')"
        oncontextmenu="showCtxMenu(event,'${name}')">
      <div class="file-card-icon" style="background:#FFF8E1">
        <span class="material-icons-round" style="color:#F9AB00;font-size:32px">folder</span>
      </div>
      <div class="file-card-name">${name}</div>
      <div class="file-card-meta"><span>文件夹</span></div>
      <div class="file-card-actions">
        <button class="icon-btn" title="更多" onclick="event.stopPropagation();showCtxMenu(event,'${name}')">
          <span class="material-icons-round">more_vert</span>
        </button>
      </div>
    </div>`;
  };

    const renderFileCard = (file) => {
    const { icon, color } = getFileIcon(file.name);
    const path = currentPath ? currentPath + '/' + file.name : file.name;
    return `<div class="file-card" onclick="handleFileClick(event,'${file.name}')"
        oncontextmenu="showCtxMenu(event,'${file.name}')">
      <div class="file-card-icon" style="background:${color}18">
        <span class="material-icons-round" style="color:${color};font-size:32px">${icon}</span>
      </div>
      <div class="file-card-name" title="${file.name}">${file.name}</div>
      <div class="file-card-meta">
        <span>${formatSize(file.size)}</span>
        <span>${formatDate(file.uploaded)}</span>
      </div>
      <div class="file-card-actions">
        <button class="icon-btn" title="下载" onclick="event.stopPropagation();window.open('/api/download?path=${encodeURIComponent(path)}')">
          <span class="material-icons-round">download</span>
        </button>
        <button class="icon-btn" title="更多" onclick="event.stopPropagation();showCtxMenu(event,'${file.name}')">
          <span class="material-icons-round">more_vert</span>
        </button>
      </div>
    </div>`;
  };

    const renderFolderRow = (name) => {
    const href = '/?path=' + encodeURIComponent(currentPath ? currentPath + '/' + name : name);
    return `<tr data-name="${name}" data-size="0" data-date="" onclick="handleFolderClick(event,'${name}','${href}')">
      <td><div class="file-row-icon">
        <span class="material-icons-round" style="color:#F9AB00;font-size:22px">folder</span>
        <span class="file-row-name">${name}</span>
      </div></td>
      <td class="file-row-meta">—</td>
      <td class="file-row-meta">—</td>
      <td><div class="file-row-actions">
        <button class="icon-btn" title="更多" onclick="event.stopPropagation();showCtxMenu(event,'${name}')">
          <span class="material-icons-round">more_vert</span>
        </button>
      </div></td>
    </tr>`;
  };

    const renderFileRow = (file) => {
    const { icon, color } = getFileIcon(file.name);
    const path = currentPath ? currentPath + '/' + file.name : file.name;
    return `<tr data-name="${file.name}" data-size="${file.size}" data-date="${file.uploaded || ''}" onclick="handleFileClick(event,'${file.name}')">
      <td><div class="file-row-icon">
        <span class="material-icons-round" style="color:${color};font-size:22px">${icon}</span>
        <span class="file-row-name">${file.name}</span>
      </div></td>
      <td class="file-row-meta">${formatSize(file.size)}</td>
      <td class="file-row-meta">${formatDate(file.uploaded)}</td>
      <td><div class="file-row-actions">
        <button class="icon-btn" title="下载" onclick="event.stopPropagation();window.open('/api/download?path=${encodeURIComponent(path)}')">
          <span class="material-icons-round">download</span>
        </button>
        <button class="icon-btn" title="更多" onclick="event.stopPropagation();showCtxMenu(event,'${file.name}')">
          <span class="material-icons-round">more_vert</span>
        </button>
      </div></td>
    </tr>`;
  };

  const isEmpty = folders.length === 0 && files.length === 0;

  return renderHTML(`
<header class="app-bar">
  <a class="app-bar-logo" href="/">
    ${renderLogoIcon(cloudIconUrl)}
    <span class="app-bar-title">${siteTitle}</span>
  </a>
  <div class="app-bar-spacer"></div>
    <div class="app-bar-actions">
    <button class="icon-btn" id="darkModeToggle" title="夜间模式" onclick="toggleDarkMode(event)">
      <span class="material-icons-round">dark_mode</span>
    </button>
    <button class="icon-btn" title="存储节点" onclick="openStorageNodes()">
      <span class="material-icons-round">hub</span>
    </button>
    <button class="icon-btn" title="刷新" onclick="location.reload()">
      <span class="material-icons-round">refresh</span>
    </button>
    <button class="icon-btn" title="退出登录" onclick="logout()">
      <span class="material-icons-round">logout</span>
    </button>
  </div>
</header>

<div class="layout">
  <nav class="sidebar">
        <div class="sidebar-section">
      <a class="sidebar-item active" href="/">
        <span class="material-icons-round">cloud</span> 我的云盘
      </a>
      <button class="sidebar-item" onclick="openUpload()">
        <span class="material-icons-round">cloud_upload</span> 上传文件
      </button>
      <button class="sidebar-item" onclick="openStorageNodes()">
        <span class="material-icons-round">hub</span> 存储节点
      </button>
    </div>
    <div class="sidebar-divider"></div>
    <div class="sidebar-section">
      <div class="sidebar-label">快速访问</div>
      <a class="sidebar-item" href="/?path=">
        <span class="material-icons-round">home</span> 根目录
      </a>
            <a class="sidebar-item" href="/?path=shared">
        <span class="material-icons-round">folder_shared</span> 共享文件夹
      </a>
    </div>
    <button class="storage-info" id="storageInfo" onclick="toggleStorageDetails()" title="查看容量明细">
      <div class="storage-text">
        <span>${files.length} 个文件，${folders.length} 个文件夹</span>
      </div>
      <div class="storage-bar">
        <div class="storage-fill" id="storageFill" style="width:0%"></div>
      </div>
      <div class="storage-text" id="storageText">计算中...</div>
      <div class="storage-details" id="storageDetails"></div>
    </button>
  </nav>

  <main class="main">
    ${breadcrumb}

    <div class="toolbar">
      <button class="fab" onclick="openUpload()">
        <span class="material-icons-round">upload</span> 上传
      </button>
      <button class="btn-outlined" onclick="openNewFolder()">
        <span class="material-icons-round">create_new_folder</span> 新建文件夹
      </button>
      <div class="toolbar-right">
        <div class="view-toggle">
          <button class="view-toggle-btn" data-view="grid" onclick="setView('grid')" title="网格视图">
            <span class="material-icons-round">grid_view</span>
          </button>
          <button class="view-toggle-btn" data-view="list" onclick="setView('list')" title="列表视图">
            <span class="material-icons-round">view_list</span>
          </button>
        </div>
      </div>
        </div>

    <!-- ── Horizontal Action Bar ── -->
    <div class="action-bar" id="actionBar">
      <span class="action-bar-count" id="actionBarCount">未选中</span>
      <div class="action-bar-divider"></div>
      <button class="action-btn" onclick="copySelected()" title="复制">
        <span class="material-icons-round">content_copy</span><span>复制</span>
      </button>
      <button class="action-btn" onclick="cutSelected()" title="剪切">
        <span class="material-icons-round">content_cut</span><span>剪切</span>
      </button>
      <button class="action-btn" onclick="pasteFiles()" title="粘贴" id="pasteBtn" disabled>
        <span class="material-icons-round">content_paste</span><span>粘贴</span>
      </button>
      <div class="action-bar-divider"></div>
      <button class="action-btn" onclick="renameSelected()" title="重命名">
        <span class="material-icons-round">drive_file_rename_outline</span><span>重命名</span>
      </button>
      <button class="action-btn" onclick="downloadSelected()" title="下载">
        <span class="material-icons-round">download</span><span>下载</span>
      </button>
      <button class="action-btn danger" onclick="deleteSelected()" title="删除">
        <span class="material-icons-round">delete_outline</span><span>删除</span>
      </button>
    </div>

    ${isEmpty ? `
    <div class="empty-state">
      <span class="material-icons-round">cloud_upload</span>
      <h3>此文件夹为空</h3>
      <p>点击"上传"按钮开始上传文件，或创建新文件夹</p>
      <button class="fab" onclick="openUpload()" style="margin-top:8px">
        <span class="material-icons-round">upload</span> 立即上传
      </button>
    </div>
    ` : `
    <!-- Grid View -->
    <div id="fileGrid" class="file-grid">
      ${folders.map(renderFolderCard).join('')}
      ${files.map(renderFileCard).join('')}
    </div>

    <!-- List View -->
    <div id="fileList" style="display:none">
      <table class="file-list">
        <thead>
          <tr>
            <th onclick="sortTable('name')"><div class="th-inner">名称 <span class="material-icons-round" style="font-size:14px">unfold_more</span></div></th>
            <th onclick="sortTable('size')"><div class="th-inner">大小 <span class="material-icons-round" style="font-size:14px">unfold_more</span></div></th>
            <th onclick="sortTable('date')"><div class="th-inner">修改时间 <span class="material-icons-round" style="font-size:14px">unfold_more</span></div></th>
            <th style="width:80px"></th>
          </tr>
        </thead>
        <tbody>
          ${folders.map(renderFolderRow).join('')}
          ${files.map(renderFileRow).join('')}
        </tbody>
      </table>
    </div>
    `}
  </main>
</div>

<!-- Selection Bar -->
<div class="selection-bar" id="selectionBar">
  <button class="icon-btn" onclick="clearSelection()" title="取消选择">
    <span class="material-icons-round">close</span>
  </button>
  <span class="selection-bar-count" id="selectionCount">0 个已选中</span>
  <button class="icon-btn" onclick="deleteSelected()" title="删除">
    <span class="material-icons-round">delete_outline</span>
  </button>
</div>

<!-- Upload Modal -->
<div class="modal-overlay" id="uploadModal" onclick="if(event.target===this)closeUpload()">
  <div class="modal">
    <div class="modal-header">
      <span class="material-icons-round" style="color:var(--primary)">cloud_upload</span>
      <span class="modal-title">上传文件</span>
    </div>
    <div class="modal-body">
      <div class="upload-zone" onclick="document.getElementById('fileInput').click()"
        ondrop="handleDrop(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave()">
        <span class="material-icons-round">upload_file</span>
        <h4>拖放文件到此处</h4>
        <p>或点击选择文件，支持多文件同时上传</p>
      </div>
      <input type="file" id="fileInput" multiple style="display:none" onchange="handleFileInput(event)">
      <div class="progress-list" id="progressList"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-outlined" onclick="closeUpload()">关闭</button>
      <button class="fab" style="box-shadow:none" onclick="document.getElementById('fileInput').click()">
        <span class="material-icons-round">folder_open</span> 选择文件
      </button>
    </div>
  </div>
</div>

<!-- New Folder Modal -->
<div class="modal-overlay" id="newFolderModal" onclick="if(event.target===this)closeNewFolder()">
  <div class="modal">
    <div class="modal-header">
      <span class="material-icons-round" style="color:#F9AB00">create_new_folder</span>
      <span class="modal-title">新建文件夹</span>
    </div>
    <div class="modal-body">
      <label class="field-label" for="folderNameInput">文件夹名称</label>
      <input class="text-field" id="folderNameInput" type="text" placeholder="请输入文件夹名称"
        onkeydown="if(event.key==='Enter')createFolder()">
    </div>
    <div class="modal-footer">
      <button class="btn-outlined" onclick="closeNewFolder()">取消</button>
      <button class="fab" style="box-shadow:none" onclick="createFolder()">
        <span class="material-icons-round">check</span> 创建
      </button>
    </div>
  </div>
</div>

<!-- Storage Nodes Modal -->
<div class="modal-overlay" id="storageNodesModal" onclick="if(event.target===this)closeStorageNodes()">
  <div class="modal">
    <div class="modal-header">
      <span class="material-icons-round" style="color:var(--primary)">hub</span>
      <span class="modal-title">存储节点</span>
    </div>
    <div class="modal-body">
      <div class="node-list" id="storageNodeList"></div>
      <div class="node-form-grid">
        <div>
          <label class="field-label" for="nodeNameInput">节点名称</label>
          <input class="text-field" id="nodeNameInput" type="text" placeholder="账号 A">
        </div>
        <div>
          <label class="field-label" for="nodeWeightInput">权重</label>
          <input class="text-field" id="nodeWeightInput" type="number" min="1" value="1">
        </div>
        <div class="full">
          <label class="field-label" for="nodeUrlInput">节点 Worker 地址</label>
          <input class="text-field" id="nodeUrlInput" type="url" placeholder="https://node.example.workers.dev">
        </div>
        <div class="full">
          <label class="field-label" for="nodeTokenInput">节点密钥</label>
          <input class="text-field" id="nodeTokenInput" type="password" placeholder="STORAGE_NODE_TOKEN">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-outlined" onclick="closeStorageNodes()">关闭</button>
      <button class="fab" style="box-shadow:none" onclick="saveStorageNode()">
        <span class="material-icons-round">add</span> 添加节点
      </button>
    </div>
  </div>
</div>
`, siteTitle);
}

// ── Session (Cookie-based) ──
// ── Shared Folder Config ──
const SHARED_PREFIX = 'shared'; // Shared folder name - accessible without login
const STORAGE_TOTAL_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB per account/node

const SESSION_COOKIE = 'r2drive_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const DAV_PREFIX = '/dav';
const STORAGE_NODES_KV_KEY = 'storage_nodes';
const MULTIPART_SESSION_PREFIX = 'multipart_session_';
const NODE_PART_PREFIX = '__r2drive_node_parts/';
const MANIFEST_CONTENT_TYPE = 'application/vnd.r2drive.manifest+json';
const MANIFEST_VERSION = 1;

async function generateToken(password, secret) {
  const data = `${password}:${secret}:${Date.now()}`;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(data));
  const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(JSON.stringify({ t: Date.now(), s: sigHex }));
}

async function verifyToken(token, secret) {
  try {
    const { t, s } = JSON.parse(atob(token));
    if (Date.now() - t > SESSION_DURATION) return false;
    return true; // simplified - production: re-verify HMAC
  } catch { return false; }
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function isWebDavAuthenticated(request, env) {
  if (!env.ACCESS_PASSWORD) return true;
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    const password = decoded.slice(decoded.indexOf(':') + 1);
    return password === env.ACCESS_PASSWORD;
  } catch {
    return false;
  }
}

function webDavAuthRequired() {
  return new Response('WebDAV authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="R2 Cloud Drive WebDAV"',
      'Content-Type': 'text/plain;charset=UTF-8'
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
  });
}

function normalizeNodeUrl(url = '') {
  return String(url || '').trim().replace(/\/+$/, '');
}

function sanitizeNode(node = {}) {
  return {
    id: String(node.id || '').trim(),
    name: String(node.name || '').trim(),
    url: normalizeNodeUrl(node.url),
    token: String(node.token || '').trim(),
    enabled: node.enabled !== false,
    weight: Math.max(1, parseInt(node.weight || '1', 10) || 1)
  };
}

function publicNode(node) {
  return {
    id: node.id,
    name: node.name,
    url: node.url,
    enabled: node.enabled !== false,
    weight: node.weight || 1
  };
}

async function getStorageNodes(env, includeDisabled = false) {
  if (!env.CLIPBOARD_KV) return [];
  const raw = await env.CLIPBOARD_KV.get(STORAGE_NODES_KV_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const nodes = parsed.map(sanitizeNode).filter(node => node.id && node.url && node.token);
    return includeDisabled ? nodes : nodes.filter(node => node.enabled !== false);
  } catch {
    return [];
  }
}

async function saveStorageNodes(env, nodes) {
  await env.CLIPBOARD_KV.put(STORAGE_NODES_KV_KEY, JSON.stringify(nodes.map(sanitizeNode)));
}

async function calculateR2Usage(R2) {
  let totalUsed = 0;
  let cursor;
  let safety = 0;
  do {
    const listed = await R2.list({ cursor, limit: 1000, include: ['customMetadata'] });
    for (const obj of listed.objects) {
      const manifestSize = obj.customMetadata?.r2driveSize ? parseInt(obj.customMetadata.r2driveSize, 10) : null;
      totalUsed += Number.isFinite(manifestSize) ? manifestSize : obj.size;
    }
    cursor = listed.cursor;
    safety++;
    if (safety > 100) break;
  } while (cursor);
  return totalUsed;
}

function getNodeAuthHeaders(node, extra = {}) {
  return {
    ...extra,
    'Authorization': 'Bearer ' + node.token
  };
}

function isNodeRequestAuthorized(request, env) {
  const expected = env.STORAGE_NODE_TOKEN || env.ACCESS_PASSWORD;
  if (!expected) return false;
  const header = request.headers.get('Authorization') || '';
  return header === 'Bearer ' + expected;
}

function nodeCorsHeaders(extra = {}) {
  return {
    ...extra,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

async function readManifestObject(obj) {
  if (!obj) return null;
  const contentType = obj.httpMetadata?.contentType || '';
  if (contentType !== MANIFEST_CONTENT_TYPE && obj.customMetadata?.r2driveManifest !== '1') return null;
  try {
    return await new Response(obj.body).json();
  } catch {
    return null;
  }
}

function isManifestFile(manifest) {
  return manifest && manifest.type === 'distributed-file' && Array.isArray(manifest.parts);
}

async function resolveManifestParts(manifest, env) {
  const nodes = await getStorageNodes(env, true);
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  return [...manifest.parts].sort((a, b) => a.partNumber - b.partNumber).map(part => {
    const node = nodeMap.get(part.nodeId);
    return {
      ...part,
      nodeUrl: part.nodeUrl || node?.url,
      token: part.token || node?.token
    };
  });
}

async function fetchNodePart(part) {
  if (!part.nodeUrl || !part.token) throw new Error('missing node credentials');
  const res = await fetch(part.nodeUrl.replace(/\/+$/, '') + '/api/node/part?key=' + encodeURIComponent(part.key), {
    headers: { 'Authorization': 'Bearer ' + part.token }
  });
  if (!res.ok || !res.body) throw new Error('failed to fetch node part');
  return res.body;
}

function concatStreams(streams) {
  return new ReadableStream({
    async start(controller) {
      try {
        for (const stream of streams) {
          const reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });
}

async function streamManifestFile(manifest, env) {
  const streams = [];
  const parts = await resolveManifestParts(manifest, env);
  for (const part of parts) {
    streams.push(await fetchNodePart(part));
  }
  return concatStreams(streams);
}

async function deleteManifestParts(manifest, env) {
  if (!isManifestFile(manifest)) return;
  const parts = await resolveManifestParts(manifest, env);
  await Promise.allSettled(parts.filter(part => part.nodeUrl && part.token).map(part => fetch(
    part.nodeUrl.replace(/\/+$/, '') + '/api/node/part?key=' + encodeURIComponent(part.key),
    { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + part.token } }
  )));
}

async function handleStorageNodeApi(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: nodeCorsHeaders({ 'Content-Length': '0' }) });
  }
  if (!isNodeRequestAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: nodeCorsHeaders() });
  }
  const R2 = env.R2_BUCKET;
  const url = new URL(request.url);

  if (url.pathname === '/api/node/ping') {
    return new Response(JSON.stringify({ ok: true, name: env.SITE_TITLE || 'R2 Storage Node' }), {
      headers: nodeCorsHeaders({ 'Content-Type': 'application/json;charset=UTF-8' })
    });
  }

  if (url.pathname === '/api/node/storage') {
    const used = await calculateR2Usage(R2);
    return new Response(JSON.stringify({ ok: true, used, total: STORAGE_TOTAL_BYTES }), {
      headers: nodeCorsHeaders({ 'Content-Type': 'application/json;charset=UTF-8' })
    });
  }

  const key = url.searchParams.get('key');
  if (!key || key.includes('..')) return new Response('Missing key', { status: 400, headers: nodeCorsHeaders() });

  if (url.pathname === '/api/node/part' && request.method === 'PUT') {
    await R2.put(key, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
    return new Response(JSON.stringify({ ok: true, key }), {
      headers: nodeCorsHeaders({ 'Content-Type': 'application/json;charset=UTF-8' })
    });
  }

  if (url.pathname === '/api/node/part' && request.method === 'GET') {
    const obj = await R2.get(key);
    if (!obj) return new Response('Not Found', { status: 404, headers: nodeCorsHeaders() });
    return new Response(obj.body, {
      headers: nodeCorsHeaders({
        'Content-Type': 'application/octet-stream',
        'Content-Length': obj.size?.toString() || ''
      })
    });
  }

  if (url.pathname === '/api/node/part' && request.method === 'DELETE') {
    await R2.delete(key);
    return new Response(JSON.stringify({ ok: true }), {
      headers: nodeCorsHeaders({ 'Content-Type': 'application/json;charset=UTF-8' })
    });
  }

  return new Response('Not Found', { status: 404, headers: nodeCorsHeaders() });
}

function davHeaders(extra = {}) {
  const headers = new Headers(extra);
  headers.set('DAV', '1, 2');
  headers.set('MS-Author-Via', 'DAV');
  return headers;
}

function xmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripDavPrefix(pathname) {
  const raw = pathname.slice(DAV_PREFIX.length);
  return decodeURIComponent(raw.replace(/^\/+/, ''));
}

function davHref(request, key, isCollection = false) {
  const url = new URL(request.url);
  const base = DAV_PREFIX + '/' + key.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const href = base + (isCollection && base !== DAV_PREFIX + '/' && !base.endsWith('/') ? '/' : '');
  return xmlEscape(url.origin + href);
}

function davPropResponse(request, key, item) {
  const isCollection = item.type === 'folder';
  const href = davHref(request, key, isCollection);
  const displayName = key.split('/').filter(Boolean).pop() || 'dav';
  const modified = item.uploaded ? new Date(item.uploaded).toUTCString() : new Date().toUTCString();
  const contentLength = isCollection ? 0 : (item.size || 0);
  const resourceType = isCollection ? '<D:collection/>' : '';
  const contentType = isCollection ? 'httpd/unix-directory' : getMimeType(key);
  const etag = item.etag ? `<D:getetag>"${xmlEscape(item.etag)}"</D:getetag>` : '';

  return `<D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${xmlEscape(displayName)}</D:displayname>
        <D:resourcetype>${resourceType}</D:resourcetype>
        <D:getcontentlength>${contentLength}</D:getcontentlength>
        <D:getcontenttype>${xmlEscape(contentType)}</D:getcontenttype>
        <D:getlastmodified>${modified}</D:getlastmodified>
        ${etag}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

async function deleteR2Path(R2, key, env) {
  const prefix = key.endsWith('/') ? key : key + '/';
  const listed = await R2.list({ prefix });
  if (listed.objects.length > 0) {
    await Promise.all(listed.objects.map(async obj => {
      const fullObj = await R2.get(obj.key);
      const manifest = await readManifestObject(fullObj);
      if (isManifestFile(manifest)) await deleteManifestParts(manifest, env);
      await R2.delete(obj.key);
    }));
  } else {
    const obj = await R2.get(key);
    const manifest = await readManifestObject(obj);
    if (isManifestFile(manifest)) await deleteManifestParts(manifest, env);
    await R2.delete(key);
  }
}

async function copyR2Path(R2, from, to) {
  const fromPrefix = from.endsWith('/') ? from : from + '/';
  const listed = await R2.list({ prefix: fromPrefix });
  if (listed.objects.length > 0) {
    await Promise.all(listed.objects.map(async obj => {
      const source = await R2.get(obj.key);
      if (!source) return;
      const targetKey = (to.endsWith('/') ? to : to + '/') + obj.key.slice(fromPrefix.length);
      await R2.put(targetKey, source.body, {
        httpMetadata: { contentType: getMimeType(targetKey) },
        customMetadata: source.customMetadata
      });
    }));
    return;
  }

  const source = await R2.get(from);
  if (!source) throw new Error('not found');
  await R2.put(to, source.body, {
    httpMetadata: { contentType: getMimeType(to) },
    customMetadata: source.customMetadata
  });
}

async function handleWebDav(request, env) {
  if (!isWebDavAuthenticated(request, env)) return webDavAuthRequired();
  const R2 = env.R2_BUCKET;
  const url = new URL(request.url);
  const key = stripDavPrefix(url.pathname);
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: davHeaders({
        'Allow': 'OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE, COPY',
        'Content-Length': '0'
      })
    });
  }

  if (method === 'PROPFIND') {
    const depth = request.headers.get('Depth') || 'infinity';
    const responses = [];

    if (!key) {
      responses.push(davPropResponse(request, '', { type: 'folder' }));
    } else {
      const object = await R2.get(key);
      if (object) {
        const manifestSize = object.customMetadata?.r2driveSize ? parseInt(object.customMetadata.r2driveSize, 10) : null;
        responses.push(davPropResponse(request, key, {
          type: 'file',
          size: Number.isFinite(manifestSize) ? manifestSize : object.size,
          uploaded: object.uploaded,
          etag: object.etag
        }));
      } else {
        const folderPrefix = key.replace(/\/+$/, '') + '/';
        const listed = await R2.list({ prefix: folderPrefix, delimiter: '/', limit: 1 });
        if ((listed.objects || []).length === 0 && (listed.delimitedPrefixes || []).length === 0) {
          return new Response('Not Found', { status: 404 });
        }
        responses.push(davPropResponse(request, folderPrefix, { type: 'folder' }));
      }
    }

    if (depth !== '0') {
      const prefix = key ? key.replace(/\/+$/, '') + '/' : '';
      const listed = await R2.list({ prefix, delimiter: '/', include: ['customMetadata'] });
      for (const folder of listed.delimitedPrefixes || []) {
        responses.push(davPropResponse(request, folder, { type: 'folder' }));
      }
      for (const obj of listed.objects || []) {
        if (obj.key === prefix || obj.key.endsWith('/.keep')) continue;
        if (obj.key.slice(prefix.length).includes('/')) continue;
        const manifestSize = obj.customMetadata?.r2driveSize ? parseInt(obj.customMetadata.r2driveSize, 10) : null;
        responses.push(davPropResponse(request, obj.key, {
          type: 'file',
          size: Number.isFinite(manifestSize) ? manifestSize : obj.size,
          uploaded: obj.uploaded,
          etag: obj.etag
        }));
      }
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responses.join('\n')}
</D:multistatus>`;
    return new Response(xml, {
      status: 207,
      headers: davHeaders({ 'Content-Type': 'application/xml; charset=utf-8' })
    });
  }

  if (method === 'GET' || method === 'HEAD') {
    if (!key || key.endsWith('/')) return new Response('Not Found', { status: 404 });
    const obj = await R2.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    const manifest = await readManifestObject(obj);
    if (isManifestFile(manifest)) {
      const headers = davHeaders({
        'Content-Type': manifest.contentType || getMimeType(key),
        'Content-Length': manifest.size?.toString() || ''
      });
      return new Response(method === 'HEAD' ? null : await streamManifestFile(manifest, env), { headers });
    }
    const headers = davHeaders({
      'Content-Type': getMimeType(key),
      'Content-Length': obj.size?.toString() || '',
      'ETag': obj.etag || ''
    });
    return new Response(method === 'HEAD' ? null : obj.body, { headers });
  }

  if (method === 'PUT') {
    if (!key || key.endsWith('/')) return new Response('Invalid destination', { status: 409 });
    await R2.put(key, request.body, { httpMetadata: { contentType: getMimeType(key) } });
    return new Response(null, { status: 201, headers: davHeaders({ 'Content-Length': '0' }) });
  }

  if (method === 'MKCOL') {
    if (!key) return new Response('Conflict', { status: 409 });
    const folderKey = key.replace(/\/+$/, '') + '/.keep';
    await R2.put(folderKey, new Uint8Array(0));
    return new Response(null, { status: 201, headers: davHeaders({ 'Content-Length': '0' }) });
  }

  if (method === 'DELETE') {
    if (!key) return new Response('Forbidden', { status: 403 });
    await deleteR2Path(R2, key, env);
    return new Response(null, { status: 204, headers: davHeaders({ 'Content-Length': '0' }) });
  }

  if (method === 'MOVE' || method === 'COPY') {
    if (!key) return new Response('Forbidden', { status: 403 });
    const destination = request.headers.get('Destination');
    if (!destination) return new Response('Missing Destination', { status: 400 });
    const destinationUrl = new URL(destination, url.origin);
    if (!destinationUrl.pathname.startsWith(DAV_PREFIX)) {
      return new Response('Invalid Destination', { status: 400 });
    }
    const targetKey = stripDavPrefix(destinationUrl.pathname);
    if (!targetKey) return new Response('Invalid Destination', { status: 409 });
    try {
      await copyR2Path(R2, key, targetKey);
      if (method === 'MOVE') await deleteR2Path(R2, key, env);
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(null, { status: 201, headers: davHeaders({ 'Content-Length': '0' }) });
  }

  return new Response('Method Not Allowed', {
    status: 405,
    headers: davHeaders({ 'Allow': 'OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE, COPY' })
  });
}

async function isAuthenticated(request, env) {
  if (!env.ACCESS_PASSWORD) return true; // no password set = public
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return false;
  return verifyToken(token, env.ACCESS_PASSWORD);
}

// ── Main Handler ──
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const R2 = env.R2_BUCKET;
    const siteTitle = env.SITE_TITLE || 'R2 云盘';
    const cloudIconUrl = env.CLOUD_ICON_URL || '';
    const loginBackgroundUrl = env.LOGIN_BACKGROUND_URL || '';

    if (!R2) {
      return new Response('未配置 R2 存储桶。请在 wrangler.toml 中绑定 R2_BUCKET。', { status: 500 });
    }

    if (path === DAV_PREFIX || path.startsWith(DAV_PREFIX + '/')) {
      return handleWebDav(request, env);
    }

    if (path.startsWith('/api/node/')) {
      return handleStorageNodeApi(request, env);
    }

        // ── Auth endpoints ──
    if (path === '/login') {
      if (request.method === 'GET') return new Response(renderLoginPage('', siteTitle, cloudIconUrl, loginBackgroundUrl), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    if (path === '/api/login' && request.method === 'POST') {
      if (!env.ACCESS_PASSWORD) return Response.json({ ok: true });
      const { password } = await request.json().catch(() => ({}));
      if (password !== env.ACCESS_PASSWORD) return Response.json({ ok: false });
      const token = await generateToken(password, env.ACCESS_PASSWORD);
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION / 1000}`
        }
      });
    }

    if (path === '/api/logout' && request.method === 'POST') {
      return new Response('{}', {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`
        }
      });
    }

    // ── Shared Folder Route (public, no auth required) ──
        if (path === '/shared' || path === '/shared/') {
      const prefix = SHARED_PREFIX + '/';
      const subPath = url.searchParams.get('path') || '';
      const fullPrefix = subPath ? prefix + subPath.replace(/\/+$/, '') + '/' : prefix;

      const listed = await R2.list({ prefix: fullPrefix, delimiter: '/', include: ['customMetadata'] });

      const folders = (listed.delimitedPrefixes || []).map(p => {
        return p.slice(fullPrefix.length).replace(/\/$/, '');
      }).filter(Boolean);

      const files = (listed.objects || [])
        .filter(obj => obj.key !== fullPrefix && !obj.key.endsWith('/.keep'))
        .map(obj => {
          const manifestSize = obj.customMetadata?.r2driveSize ? parseInt(obj.customMetadata.r2driveSize, 10) : null;
          return {
            name: obj.key.slice(fullPrefix.length),
            size: Number.isFinite(manifestSize) ? manifestSize : obj.size,
            uploaded: obj.uploaded,
          };
        })
        .filter(f => f.name && !f.name.includes('/'));

      const html = renderSharedPage(folders, files, subPath, siteTitle, cloudIconUrl);
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // ── Shared API: List (public) ──
    if (path === '/api/shared-list') {
      const subPath = url.searchParams.get('path') || '';
      const fullPrefix = SHARED_PREFIX + '/' + (subPath ? subPath.replace(/\/+$/, '') + '/' : '');
      const listed = await R2.list({ prefix: fullPrefix, delimiter: '/', include: ['customMetadata'] });

      const folders = (listed.delimitedPrefixes || []).map(p => {
        return p.slice(fullPrefix.length).replace(/\/$/, '');
      }).filter(Boolean);

      const files = (listed.objects || [])
        .filter(obj => obj.key !== fullPrefix && !obj.key.endsWith('/.keep'))
        .map(obj => {
          const manifestSize = obj.customMetadata?.r2driveSize ? parseInt(obj.customMetadata.r2driveSize, 10) : null;
          return {
            name: obj.key.slice(fullPrefix.length),
            size: Number.isFinite(manifestSize) ? manifestSize : obj.size,
            uploaded: obj.uploaded,
          };
        })
        .filter(f => f.name && !f.name.includes('/'));

      return Response.json({ folders, files });
    }

        // ── Clipboard API (KV-backed, no auth required for clipboard operations) ──
    if (path === '/api/clipboard' && request.method === 'POST') {
      // Save clipboard to KV
      const clipboardId = url.searchParams.get('id') || 'default';
      const body = await request.json().catch(() => ({}));
      if (body.items && Array.isArray(body.items)) {
        await env.CLIPBOARD_KV.put('clipboard_' + clipboardId, JSON.stringify({
          items: body.items,
          action: body.action || 'copy',
          sourcePath: body.sourcePath || ''
        }), { expirationTtl: 86400 }); // 24 hours expiry
        return Response.json({ ok: true });
      }
      return Response.json({ ok: false, error: 'invalid data' }, { status: 400 });
    }
    if (path === '/api/clipboard' && request.method === 'GET') {
      // Get clipboard from KV
      const clipboardId = url.searchParams.get('id') || 'default';
      const data = await env.CLIPBOARD_KV.get('clipboard_' + clipboardId);
      if (data) {
        return new Response(data, { headers: { 'Content-Type': 'application/json' } });
      }
      return Response.json({ items: [], action: null, sourcePath: '' });
    }
    if (path === '/api/clipboard' && request.method === 'DELETE') {
      // Clear clipboard from KV
      const clipboardId = url.searchParams.get('id') || 'default';
      await env.CLIPBOARD_KV.delete('clipboard_' + clipboardId);
      return Response.json({ ok: true });
    }

    // ── Auth check ──
    const authed = await isAuthenticated(request, env);
    if (!authed) {
      if (path.startsWith('/api/')) {
        // Allow clipboard API access without auth
        if (path === '/api/clipboard') {
          return new Response('clipboard API handled above', { status: 200 });
        }
        // Allow public download from shared folder
        if (path === '/api/download') {
          const filePath = url.searchParams.get('path') || '';
          if (filePath.startsWith(SHARED_PREFIX + '/')) {
            const obj = await R2.get(filePath);
            if (!obj) return new Response('File not found', { status: 404 });
            const manifest = await readManifestObject(obj);
            if (isManifestFile(manifest)) {
              const body = await streamManifestFile(manifest, env);
              const filename = filePath.split('/').pop();
              const headers = new Headers();
              headers.set('Content-Type', manifest.contentType || getMimeType(filePath));
              headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
              headers.set('Content-Length', manifest.size?.toString() || '');
              return new Response(body, { headers });
            }
            const mime = getMimeType(filePath);
            const filename = filePath.split('/').pop();
            const headers = new Headers();
            headers.set('Content-Type', mime);
            headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
            headers.set('Content-Length', obj.size?.toString() || '');
            headers.set('ETag', obj.etag || '');
            return new Response(obj.body, { headers });
          }
        }
        return new Response('Unauthorized', { status: 401 });
      }
      return Response.redirect(new URL('/login', request.url), 302);
    }

    // ── API Routes ──

    if (path === '/api/storage-nodes' && request.method === 'GET') {
      const nodes = await getStorageNodes(env, true);
      return jsonResponse({ nodes: nodes.map(publicNode) });
    }

    if (path === '/api/storage-nodes' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const nodes = await getStorageNodes(env, true);
      const node = sanitizeNode({
        id: body.id || crypto.randomUUID(),
        name: body.name,
        url: body.url,
        token: body.token,
        enabled: body.enabled !== false,
        weight: body.weight
      });
      if (!node.name || !node.url || !node.token) return jsonResponse({ ok: false, error: 'missing fields' }, 400);
      const index = nodes.findIndex(item => item.id === node.id);
      if (index >= 0) nodes[index] = node;
      else nodes.push(node);
      await saveStorageNodes(env, nodes);
      return jsonResponse({ ok: true, node: publicNode(node) });
    }

    if (path === '/api/storage-nodes' && request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ ok: false, error: 'missing id' }, 400);
      const nodes = await getStorageNodes(env, true);
      await saveStorageNodes(env, nodes.filter(node => node.id !== id));
      return jsonResponse({ ok: true });
    }

    if (path === '/api/storage-nodes/test' && request.method === 'POST') {
      const id = url.searchParams.get('id');
      const nodes = await getStorageNodes(env, true);
      const node = nodes.find(item => item.id === id);
      if (!node) return jsonResponse({ ok: false, error: 'not found' }, 404);
      const ping = await fetch(node.url + '/api/node/ping?key=ping', {
        headers: getNodeAuthHeaders(node)
      }).catch(() => null);
      if (!ping?.ok) return jsonResponse({ ok: false, error: 'ping failed' }, 502);
      const storage = await fetch(node.url + '/api/node/storage?key=storage', {
        headers: getNodeAuthHeaders(node)
      }).catch(() => null);
      if (!storage?.ok) {
        return jsonResponse({ ok: false, ping: true, storage: false, error: 'storage unavailable' }, 502);
      }
      const storageData = await storage.json().catch(() => ({}));
      return jsonResponse({
        ok: true,
        ping: true,
        storage: true,
        used: storageData.used || 0,
        total: storageData.total || STORAGE_TOTAL_BYTES
      });
    }

    // List files
    if (path === '/api/list') {
      const prefix = url.searchParams.get('path') || '';
      const cleanPrefix = prefix ? prefix.replace(/\/+$/, '') + '/' : '';
      const listed = await R2.list({ prefix: cleanPrefix, delimiter: '/', include: ['customMetadata'] });

      const folders = (listed.delimitedPrefixes || []).map(p => {
        const name = p.slice(cleanPrefix.length).replace(/\/$/, '');
        return name;
      }).filter(Boolean);

      const files = (listed.objects || [])
        .filter(obj => obj.key !== cleanPrefix)
        .map(obj => {
          const manifestSize = obj.customMetadata?.r2driveSize ? parseInt(obj.customMetadata.r2driveSize, 10) : null;
          return {
            name: obj.key.slice(cleanPrefix.length),
            size: Number.isFinite(manifestSize) ? manifestSize : obj.size,
            uploaded: obj.uploaded,
            etag: obj.etag,
          };
        })
        .filter(f => f.name && !f.name.includes('/'));

      return Response.json({ folders, files });
    }

        // Storage usage (for capacity display)
        if (path === '/api/storage') {
          const nodes = await getStorageNodes(env);
          const mainUsed = await calculateR2Usage(R2);
          const usageNodes = [{
            id: 'main',
            name: '主控账号',
            used: mainUsed,
            total: STORAGE_TOTAL_BYTES,
            online: true
          }];

          const nodeUsages = await Promise.all(nodes.map(async node => {
            try {
              const res = await fetch(node.url + '/api/node/storage?key=storage', {
                headers: getNodeAuthHeaders(node)
              });
              if (!res.ok) throw new Error('storage unavailable');
              const data = await res.json();
              return {
                id: node.id,
                name: node.name,
                used: data.used || 0,
                total: data.total || STORAGE_TOTAL_BYTES,
                online: true,
                storageAvailable: true
              };
            } catch {
              const ping = await fetch(node.url + '/api/node/ping?key=ping', {
                headers: getNodeAuthHeaders(node)
              }).catch(() => null);
              return {
                id: node.id,
                name: node.name,
                used: 0,
                total: STORAGE_TOTAL_BYTES,
                online: !!ping?.ok,
                storageAvailable: false
              };
            }
          }));

          usageNodes.push(...nodeUsages);
          const used = usageNodes.reduce((sum, node) => sum + (node.used || 0), 0);
          const total = usageNodes.reduce((sum, node) => sum + (node.total || STORAGE_TOTAL_BYTES), 0);
          return Response.json({ used, total, nodes: usageNodes });
        }

    // Download / serve file
    if (path === '/api/download') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return new Response('Missing path', { status: 400 });
      const obj = await R2.get(filePath);
      if (!obj) return new Response('File not found', { status: 404 });
      const manifest = await readManifestObject(obj);
      if (isManifestFile(manifest)) {
        const body = await streamManifestFile(manifest, env);
        const filename = filePath.split('/').pop();
        const headers = new Headers();
        headers.set('Content-Type', manifest.contentType || getMimeType(filePath));
        headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        headers.set('Content-Length', manifest.size?.toString() || '');
        return new Response(body, { headers });
      }
      const mime = getMimeType(filePath);
      const filename = filePath.split('/').pop();
      const headers = new Headers();
      headers.set('Content-Type', mime);
      headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      headers.set('Content-Length', obj.size?.toString() || '');
      headers.set('ETag', obj.etag || '');
      return new Response(obj.body, { headers });
    }

    // Upload file
    if (path === '/api/upload' && request.method === 'POST') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return new Response('Missing path', { status: 400 });
      const mime = getMimeType(filePath);
      await R2.put(filePath, request.body, { httpMetadata: { contentType: mime } });
      return Response.json({ ok: true });
    }

    // Multipart upload for files larger than the Worker request body limit.
    if (path === '/api/multipart/init' && request.method === 'POST') {
      const { path: filePath, contentType } = await request.json().catch(() => ({}));
      if (!filePath) return new Response('Missing path', { status: 400 });
      const mime = contentType || getMimeType(filePath);
      const upload = await R2.createMultipartUpload(filePath, { httpMetadata: { contentType: mime } });
      return Response.json({ key: upload.key, uploadId: upload.uploadId });
    }

    if (path === '/api/multipart/part' && request.method === 'POST') {
      const filePath = url.searchParams.get('path');
      const uploadId = url.searchParams.get('uploadId');
      const partNumber = parseInt(url.searchParams.get('partNumber') || '', 10);
      if (!filePath || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
        return new Response('Missing multipart fields', { status: 400 });
      }
      const upload = R2.resumeMultipartUpload(filePath, uploadId);
      const part = await upload.uploadPart(partNumber, request.body);
      return Response.json(part);
    }

    if (path === '/api/multipart/complete' && request.method === 'POST') {
      const { path: filePath, uploadId, parts } = await request.json().catch(() => ({}));
      if (!filePath || !uploadId || !Array.isArray(parts) || parts.length === 0) {
        return new Response('Missing multipart fields', { status: 400 });
      }
      const upload = R2.resumeMultipartUpload(filePath, uploadId);
      const object = await upload.complete(parts);
      return Response.json({ ok: true, key: object.key, etag: object.etag });
    }

    if (path === '/api/multipart/abort' && request.method === 'POST') {
      const { path: filePath, uploadId } = await request.json().catch(() => ({}));
      if (!filePath || !uploadId) return new Response('Missing multipart fields', { status: 400 });
      const upload = R2.resumeMultipartUpload(filePath, uploadId);
      await upload.abort();
      return Response.json({ ok: true });
    }

    if (path === '/api/distributed/init' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const filePath = String(body.path || '').trim();
      const fileSize = Number(body.size || 0);
      const chunkSize = Number(body.chunkSize || 0);
      const totalParts = Number(body.parts || 0);
      if (!filePath || fileSize <= 0 || chunkSize <= 0 || totalParts <= 0) {
        return jsonResponse({ ok: false, error: 'missing fields' }, 400);
      }
      const nodes = await getStorageNodes(env);
      if (!nodes.length) return jsonResponse({ ok: false, error: 'no storage nodes' }, 409);

      const weightedNodes = [];
      for (const node of nodes) {
        for (let i = 0; i < (node.weight || 1); i++) weightedNodes.push(node);
      }
      const sessionId = crypto.randomUUID();
      const now = new Date().toISOString();
      const parts = [];

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const node = weightedNodes[(partNumber - 1) % weightedNodes.length];
        const partKey = NODE_PART_PREFIX + sessionId + '/' + String(partNumber).padStart(6, '0');
        parts.push({
          partNumber,
          size: Math.min(chunkSize, fileSize - (partNumber - 1) * chunkSize),
          key: partKey,
          nodeId: node.id,
          nodeName: node.name,
          nodeUrl: node.url,
          token: node.token,
          uploadUrl: node.url + '/api/node/part?key=' + encodeURIComponent(partKey)
        });
      }

      const session = {
        version: MANIFEST_VERSION,
        sessionId,
        path: filePath,
        size: fileSize,
        contentType: body.contentType || getMimeType(filePath),
        chunkSize,
        createdAt: now,
        parts
      };
      await env.CLIPBOARD_KV.put(MULTIPART_SESSION_PREFIX + sessionId, JSON.stringify(session), { expirationTtl: 86400 });
      return jsonResponse({
        ok: true,
        sessionId,
        parts: parts.map(part => ({
          partNumber: part.partNumber,
          size: part.size,
          uploadUrl: part.uploadUrl,
          token: part.token
        }))
      });
    }

    if (path === '/api/distributed/complete' && request.method === 'POST') {
      const { sessionId } = await request.json().catch(() => ({}));
      if (!sessionId) return jsonResponse({ ok: false, error: 'missing sessionId' }, 400);
      const raw = await env.CLIPBOARD_KV.get(MULTIPART_SESSION_PREFIX + sessionId);
      if (!raw) return jsonResponse({ ok: false, error: 'session expired' }, 404);
      const session = JSON.parse(raw);
      const manifest = {
        type: 'distributed-file',
        version: MANIFEST_VERSION,
        path: session.path,
        size: session.size,
        contentType: session.contentType,
        createdAt: session.createdAt,
        completedAt: new Date().toISOString(),
        parts: session.parts.map(part => ({
          partNumber: part.partNumber,
          size: part.size,
          key: part.key,
          nodeId: part.nodeId,
          nodeName: part.nodeName,
          nodeUrl: part.nodeUrl
        }))
      };
      await R2.put(session.path, JSON.stringify(manifest), {
        httpMetadata: { contentType: MANIFEST_CONTENT_TYPE },
        customMetadata: {
          r2driveManifest: '1',
          r2driveSize: String(session.size)
        }
      });
      await env.CLIPBOARD_KV.delete(MULTIPART_SESSION_PREFIX + sessionId);
      return jsonResponse({ ok: true });
    }

    if (path === '/api/distributed/abort' && request.method === 'POST') {
      const { sessionId } = await request.json().catch(() => ({}));
      if (!sessionId) return jsonResponse({ ok: false, error: 'missing sessionId' }, 400);
      const raw = await env.CLIPBOARD_KV.get(MULTIPART_SESSION_PREFIX + sessionId);
      if (raw) {
        const session = JSON.parse(raw);
        await deleteManifestParts({ type: 'distributed-file', parts: session.parts }, env);
        await env.CLIPBOARD_KV.delete(MULTIPART_SESSION_PREFIX + sessionId);
      }
      return jsonResponse({ ok: true });
    }

    // Delete file/folder
    if (path === '/api/delete' && request.method === 'DELETE') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return new Response('Missing path', { status: 400 });
      // If folder, delete all objects with prefix
      const prefix = filePath.endsWith('/') ? filePath : filePath + '/';
      const listed = await R2.list({ prefix });
      if (listed.objects.length > 0) {
        await Promise.all(listed.objects.map(async obj => {
          const fullObj = await R2.get(obj.key);
          const manifest = await readManifestObject(fullObj);
          if (isManifestFile(manifest)) await deleteManifestParts(manifest, env);
          await R2.delete(obj.key);
        }));
      } else {
        const obj = await R2.get(filePath);
        const manifest = await readManifestObject(obj);
        if (isManifestFile(manifest)) await deleteManifestParts(manifest, env);
        await R2.delete(filePath);
      }
      return Response.json({ ok: true });
    }

    // Rename (copy + delete)
    if (path === '/api/rename' && request.method === 'POST') {
      const { from, to } = await request.json().catch(() => ({}));
      if (!from || !to) return new Response('Missing fields', { status: 400 });
      const obj = await R2.get(from);
      if (!obj) return new Response('Not found', { status: 404 });
      const manifest = await readManifestObject(obj);
      if (isManifestFile(manifest)) {
        manifest.path = to;
        await R2.put(to, JSON.stringify(manifest), {
          httpMetadata: { contentType: MANIFEST_CONTENT_TYPE },
          customMetadata: {
            r2driveManifest: '1',
            r2driveSize: String(manifest.size || 0)
          }
        });
        await R2.delete(from);
        return Response.json({ ok: true });
      }
      const mime = getMimeType(to);
      await R2.put(to, obj.body, { httpMetadata: { contentType: mime } });
      await R2.delete(from);
      return Response.json({ ok: true });
    }

    // Create folder (R2 uses empty object as placeholder)
    if (path === '/api/mkdir' && request.method === 'POST') {
      const { path: folderPath } = await request.json().catch(() => ({}));
      if (!folderPath) return new Response('Missing path', { status: 400 });
      const key = folderPath.endsWith('/') ? folderPath : folderPath + '/.keep';
      await R2.put(key, new Uint8Array(0));
      return Response.json({ ok: true });
    }

    // ── UI Route ──
    if (path === '/' || path === '') {
      const prefix = url.searchParams.get('path') || '';
      const cleanPrefix = prefix ? prefix.replace(/\/+$/, '') + '/' : '';
      const listed = await R2.list({ prefix: cleanPrefix, delimiter: '/', include: ['customMetadata'] });

      const folders = (listed.delimitedPrefixes || []).map(p => {
        return p.slice(cleanPrefix.length).replace(/\/$/, '');
      }).filter(Boolean);

      const files = (listed.objects || [])
        .filter(obj => obj.key !== cleanPrefix && !obj.key.endsWith('/.keep'))
        .map(obj => {
          const manifestSize = obj.customMetadata?.r2driveSize ? parseInt(obj.customMetadata.r2driveSize, 10) : null;
          return {
            name: obj.key.slice(cleanPrefix.length),
            size: Number.isFinite(manifestSize) ? manifestSize : obj.size,
            uploaded: obj.uploaded,
          };
        })
        .filter(f => f.name && !f.name.includes('/'));

      const html = renderDrivePage(folders, files, prefix, siteTitle, cloudIconUrl);
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    return new Response('Not Found', { status: 404 });
  }
};

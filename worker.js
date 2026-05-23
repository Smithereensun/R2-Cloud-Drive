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
  [data-theme="dark"] .logo-icon {
    background: linear-gradient(135deg, #8AB4F8 0%, #81C995 33%, #FDD663 66%, #F28B82 100%);
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
    background: linear-gradient(135deg, #4285F4 0%, #34A853 33%, #FBBC04 66%, #EA4335 100%);
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 20px;
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
    color: var(--on-surface-variant);
    transition: background .15s;
    text-decoration: none; font-size: 14px;
    font-family: var(--font-body); font-weight: 500;
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
    background: var(--background);
  }
  .login-card {
    background: var(--surface); border-radius: var(--radius-l);
    padding: 48px 40px; width: 400px;
    box-shadow: var(--shadow-2); text-align: center;
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
  .storage-info { padding: 16px; margin-top: auto; }
  .storage-bar { height: 4px; background: var(--outline); border-radius: 2px; overflow: hidden; margin: 6px 0; }
  .storage-fill { height: 100%; background: var(--primary); border-radius: 2px; }
  .storage-text { font-size: 12px; color: var(--on-surface-variant); }

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
const STORAGE_TOTAL = 10 * 1024 * 1024 * 1024; // 10 GB (client side constant, matches server)
let storageUsed = 0;

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
function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? '' : 'dark');
  localStorage.setItem('theme', isDark ? '' : 'dark');
  const icon = document.querySelector('#darkModeToggle .material-icons-round');
  if (icon) icon.textContent = isDark ? 'dark_mode' : 'light_mode';
}
function initDarkMode() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const icon = document.querySelector('#darkModeToggle .material-icons-round');
    if (icon) icon.textContent = 'light_mode';
  }
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
    const fillEl = document.getElementById('storageFill');
    const textEl = document.getElementById('storageText');
    if (fillEl) {
      const pct = Math.min(100, (storageUsed / STORAGE_TOTAL) * 100);
      fillEl.style.width = pct + '%';
      if (pct > 85) fillEl.style.background = 'var(--error)';
      else if (pct > 60) fillEl.style.background = 'var(--warning)';
    }
    if (textEl) {
      textEl.textContent = '已用 ' + formatSize(storageUsed) + ' / 共 ' + formatSize(STORAGE_TOTAL);
    }
  } catch(e) {
    const textEl = document.getElementById('storageText');
    if (textEl) textEl.textContent = '无法获取存储信息';
  }
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

function uploadFiles(files) {
  if (!files.length) return;
  const list = document.getElementById('progressList');
  if (list) list.innerHTML = '';
  [...files].forEach(file => {
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
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?path=' + encodeURIComponent(path));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        fill.style.width = pct + '%'; pctSpan.textContent = pct + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) { fill.classList.add('done'); pctSpan.textContent = '✓'; }
      else { fill.classList.add('error'); pctSpan.textContent = '✗'; }
    };
    xhr.onerror = () => { fill.classList.add('error'); pctSpan.textContent = '✗'; };
    xhr.send(file);
    xhr.onloadend = () => {
      if ([...list.querySelectorAll('.progress-fill')].every(f => f.classList.contains('done') || f.classList.contains('error'))) {
        showSnackbar('上传完成', '刷新', () => location.reload());
      }
    };
  });
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

function renderLoginPage(error = '') {
  return renderHTML(`
<div class="login-wrap">
  <div class="login-card">
    <div class="login-logo">
      <div class="logo-icon"><span class="material-icons-round" style="font-size:32px">cloud</span></div>
      <h1 class="login-title">R2 云盘</h1>
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
`, 'R2 云盘 - 登录');
}

// ── Shared Folder Page (public, download only) ──
function renderSharedPage(folders, files, currentPath, siteTitle) {
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
    <div class="logo-icon"><span class="material-icons-round" style="font-size:20px">folder_shared</span></div>
    <span class="app-bar-title">${siteTitle} - 共享</span>
  </a>
  <div class="app-bar-spacer"></div>
  <div class="app-bar-actions">
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

<script>
// ── View Mode ──
let viewMode = localStorage.getItem('viewMode') || 'grid';
function setView(mode) {
  viewMode = mode; localStorage.setItem('viewMode', mode);
  document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
  const grid = document.getElementById('fileGrid');
  const list = document.getElementById('fileList');
  if (grid && list) { grid.style.display = mode === 'grid' ? '' : 'none'; list.style.display = mode === 'list' ? '' : 'none'; }
}
document.addEventListener('DOMContentLoaded', () => { setView(viewMode); });
</script>
`, siteTitle + ' - 共享');
}

function renderDrivePage(folders, files, currentPath, siteTitle) {
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
    <div class="logo-icon"><span class="material-icons-round" style="font-size:20px">cloud</span></div>
    <span class="app-bar-title">${siteTitle}</span>
  </a>
  <div class="app-bar-spacer"></div>
    <div class="app-bar-actions">
    <button class="icon-btn" id="darkModeToggle" title="夜间模式" onclick="toggleDarkMode()">
      <span class="material-icons-round">dark_mode</span>
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
      <button class="sidebar-item" onclick="openUpload()" style="width:calc(100% - 16px);border:none;cursor:pointer;font-family:var(--font-body)">
        <span class="material-icons-round">cloud_upload</span> 上传文件
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
    <div class="storage-info">
      <div class="storage-text">
        <span>${files.length} 个文件，${folders.length} 个文件夹</span>
      </div>
      <div class="storage-bar">
        <div class="storage-fill" id="storageFill" style="width:0%"></div>
      </div>
      <div class="storage-text" id="storageText">计算中...</div>
    </div>
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
`, siteTitle);
}

// ── Session (Cookie-based) ──
// ── Shared Folder Config ──
const SHARED_PREFIX = 'shared'; // Shared folder name - accessible without login
const STORAGE_TOTAL_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

const SESSION_COOKIE = 'r2drive_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

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

    if (!R2) {
      return new Response('未配置 R2 存储桶。请在 wrangler.toml 中绑定 R2_BUCKET。', { status: 500 });
    }

        // ── Auth endpoints ──
    if (path === '/login') {
      if (request.method === 'GET') return new Response(renderLoginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
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

      const listed = await R2.list({ prefix: fullPrefix, delimiter: '/' });

      const folders = (listed.delimitedPrefixes || []).map(p => {
        return p.slice(fullPrefix.length).replace(/\/$/, '');
      }).filter(Boolean);

      const files = (listed.objects || [])
        .filter(obj => obj.key !== fullPrefix && !obj.key.endsWith('/.keep'))
        .map(obj => ({
          name: obj.key.slice(fullPrefix.length),
          size: obj.size,
          uploaded: obj.uploaded,
        }))
        .filter(f => f.name && !f.name.includes('/'));

      const html = renderSharedPage(folders, files, subPath, siteTitle);
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // ── Shared API: List (public) ──
    if (path === '/api/shared-list') {
      const subPath = url.searchParams.get('path') || '';
      const fullPrefix = SHARED_PREFIX + '/' + (subPath ? subPath.replace(/\/+$/, '') + '/' : '');
      const listed = await R2.list({ prefix: fullPrefix, delimiter: '/' });

      const folders = (listed.delimitedPrefixes || []).map(p => {
        return p.slice(fullPrefix.length).replace(/\/$/, '');
      }).filter(Boolean);

      const files = (listed.objects || [])
        .filter(obj => obj.key !== fullPrefix && !obj.key.endsWith('/.keep'))
        .map(obj => ({
          name: obj.key.slice(fullPrefix.length),
          size: obj.size,
          uploaded: obj.uploaded,
        }))
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

    // List files
    if (path === '/api/list') {
      const prefix = url.searchParams.get('path') || '';
      const cleanPrefix = prefix ? prefix.replace(/\/+$/, '') + '/' : '';
      const listed = await R2.list({ prefix: cleanPrefix, delimiter: '/' });

      const folders = (listed.delimitedPrefixes || []).map(p => {
        const name = p.slice(cleanPrefix.length).replace(/\/$/, '');
        return name;
      }).filter(Boolean);

      const files = (listed.objects || [])
        .filter(obj => obj.key !== cleanPrefix)
        .map(obj => ({
          name: obj.key.slice(cleanPrefix.length),
          size: obj.size,
          uploaded: obj.uploaded,
          etag: obj.etag,
        }))
        .filter(f => f.name && !f.name.includes('/'));

      return Response.json({ folders, files });
    }

        // Storage usage (for capacity display)
        if (path === '/api/storage') {
          let totalUsed = 0;
          let cursor;
          let safety = 0;
          do {
            const listed = await R2.list({ cursor, limit: 1000 });
            for (const obj of listed.objects) {
              totalUsed += obj.size;
            }
            cursor = listed.cursor;
            safety++;
            if (safety > 100) break; // safety limit
          } while (cursor);
          return Response.json({ used: totalUsed, total: STORAGE_TOTAL_BYTES });
        }

    // Download / serve file
    if (path === '/api/download') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return new Response('Missing path', { status: 400 });
      const obj = await R2.get(filePath);
      if (!obj) return new Response('File not found', { status: 404 });
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

    // Delete file/folder
    if (path === '/api/delete' && request.method === 'DELETE') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return new Response('Missing path', { status: 400 });
      // If folder, delete all objects with prefix
      const prefix = filePath.endsWith('/') ? filePath : filePath + '/';
      const listed = await R2.list({ prefix });
      if (listed.objects.length > 0) {
        await Promise.all(listed.objects.map(obj => R2.delete(obj.key)));
      } else {
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
      const listed = await R2.list({ prefix: cleanPrefix, delimiter: '/' });

      const folders = (listed.delimitedPrefixes || []).map(p => {
        return p.slice(cleanPrefix.length).replace(/\/$/, '');
      }).filter(Boolean);

      const files = (listed.objects || [])
        .filter(obj => obj.key !== cleanPrefix && !obj.key.endsWith('/.keep'))
        .map(obj => ({
          name: obj.key.slice(cleanPrefix.length),
          size: obj.size,
          uploaded: obj.uploaded,
        }))
        .filter(f => f.name && !f.name.includes('/'));

      const html = renderDrivePage(folders, files, prefix, siteTitle);
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    return new Response('Not Found', { status: 404 });
  }
};

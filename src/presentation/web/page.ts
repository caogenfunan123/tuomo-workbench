import { renderToolsPanel, renderToolsScript } from './tools-panel.ts';

export function renderWebApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>拓墨 · 离线写作工作台</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #202124; background: #f6f7fb; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 24px; background: #fff; border-bottom: 1px solid #e2e5ec; }
    .header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    header h1 { margin: 0; font-size: 20px; }
    header p { margin: 4px 0 0; color: #697386; font-size: 13px; }
    main { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: calc(100vh - 77px); max-width: 1440px; margin: 0 auto; }
    aside { padding: 16px; background: #fff; border-right: 1px solid #e2e5ec; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
    input, textarea, button { font: inherit; }
    input, textarea { width: 100%; padding: 10px 12px; border: 1px solid #cfd5df; border-radius: 8px; background: #fff; }
    textarea { min-height: 360px; resize: vertical; line-height: 1.6; }
    button { padding: 9px 13px; border: 1px solid #c5ccda; border-radius: 8px; color: #202124; background: #fff; cursor: pointer; }
    button:hover { background: #f0f3f9; }
    button.primary { color: #fff; border-color: #4057d6; background: #4057d6; }
    button.danger { color: #a4262c; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    #article-list { display: grid; gap: 6px; margin-top: 12px; }
    .article-item { width: 100%; text-align: left; border: 1px solid transparent; }
    .article-item.selected { border-color: #9aa9ff; background: #eef0ff; }
    .article-item strong, .article-item small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .article-item small { margin-top: 4px; color: #697386; font-size: 12px; }
    section.editor { min-width: 0; padding: 28px clamp(20px, 5vw, 72px); }
    .editor-card { max-width: 920px; margin: 0 auto; padding: 24px; background: #fff; border: 1px solid #e2e5ec; border-radius: 14px; box-shadow: 0 8px 30px rgba(35, 46, 80, .05); }
    .editor-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
    .editor-actions .right { display: flex; gap: 8px; }
    #title { margin-bottom: 14px; font-size: 22px; }
    .editor-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 10px; }
    .editor-tools small { color: #697386; }
    #toc-panel { margin: 12px 0; padding: 10px 12px; border: 1px solid #e2e5ec; border-radius: 8px; background: #fafbfe; }
    #toc-panel h3 { margin: 0 0 6px; font-size: 14px; }
    #toc-panel a { display: block; color: #4057d6; text-decoration: none; font-size: 13px; line-height: 1.7; }
    #toc-panel a[data-level="2"] { padding-left: 14px; }
    #toc-panel a[data-level="3"] { padding-left: 28px; }
    .metadata-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
    .metadata-grid label { display: grid; gap: 5px; color: #697386; font-size: 12px; }
    .metadata-grid input, .metadata-grid select { width: 100%; padding: 9px 10px; border: 1px solid #cfd5df; border-radius: 8px; background: #fff; color: #202124; }
    .metadata-grid .published-field { display: flex; align-items: center; gap: 8px; padding-top: 22px; }
    .metadata-grid .published-field input { width: auto; }
    #status { color: #697386; font-size: 13px; }
    #preview { margin-top: 22px; padding: 16px; min-height: 100px; line-height: 1.65; border: 1px dashed #cfd5df; border-radius: 8px; background: #fafbfe; }
    #preview h1, #preview h2, #preview h3 { margin: 0 0 10px; }
    #preview p { margin: 0 0 12px; }
    #preview ul { margin-top: 0; }
    #preview table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; }
    #preview th, #preview td { padding: 7px 9px; border: 1px solid #cfd5df; text-align: left; }
    #preview th { background: #eef0ff; }
    #preview pre { overflow: auto; padding: 12px; border-radius: 8px; background: #202124; color: #f7f7f7; }
    #preview code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    #preview blockquote { margin: 10px 0; padding: 4px 12px; border-left: 3px solid #4057d6; color: #697386; }
    #preview .math-block { padding: 10px; border: 1px dashed #9aa9ff; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; }
    #preview .mermaid { color: #cdd5ff; }
    #snapshots { margin-top: 22px; padding: 14px 16px; border: 1px solid #e2e5ec; border-radius: 8px; background: #fff; }
    #snapshots h3 { margin: 0 0 10px; font-size: 15px; }
    .snapshot-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #eef0f4; }
    .snapshot-item:first-child { border-top: 0; }
    .snapshot-item small { color: #697386; }
    .snapshot-actions { display: flex; gap: 6px; }
    .library-panel { margin-bottom: 16px; padding: 14px 16px; border: 1px solid #e2e5ec; border-radius: 8px; background: #fff; }
    .library-panel h3 { margin: 0 0 10px; font-size: 15px; }
    .library-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
    .library-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .library-card { padding: 10px; border: 1px solid #eef0f4; border-radius: 8px; }
    .library-card strong, .library-card small { display: block; }
    .library-card small { margin-top: 4px; color: #697386; }
    .site-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .health-panel { margin-top: 8px; padding: 8px; border: 1px solid #eef0f4; border-radius: 8px; background: #fafbfe; }
    .health-item { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 12px; }
    .health-item small { color: #697386; }
    .remote-panel { margin-top: 8px; padding: 8px; border: 1px solid #eef0f4; border-radius: 8px; background: #fafbfe; }
    .remote-item { padding: 8px 0; border-top: 1px solid #eef0f4; }
    .remote-item:first-child { border-top: 0; }
    .remote-item strong, .remote-item small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .remote-item small { color: #697386; }
    .remote-actions { display: flex; gap: 6px; margin-top: 6px; }
    .remote-content { max-height: 220px; overflow: auto; margin: 6px 0 0; padding: 8px; white-space: pre-wrap; background: #202124; color: #f7f7f7; border-radius: 6px; font-size: 12px; }
    .empty { color: #697386; text-align: center; padding: 48px 20px; }
    @media (max-width: 780px) { main { display: block; } aside { border-right: 0; border-bottom: 1px solid #e2e5ec; } #article-list { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); } section.editor { padding: 16px; } }
  </style>
</head>
<body>
  <header>
    <div><h1>拓墨</h1><p>离线优先 Markdown 写作工作台</p></div>
    <div class="header-actions">
      <input id="import-file" type="file" accept=".md,.markdown,.html,.htm,.docx" hidden>
      <button id="import" type="button">导入文件</button>
      <button id="new-article" class="primary">新建文章</button><button id="settings-button" type="button">设置</button>
    </div>
  </header>
  <main>
    <aside>
      <div class="toolbar"><button id="trash" type="button">回收站</button><button id="back-to-drafts" type="button" hidden>返回草稿</button><button id="sites-button" type="button">站点</button><button id="library-button" type="button">内容资产</button><button id="tools-button" type="button">辅助工具</button><button id="ai-button" type="button">AI</button></div>
      <div id="site-controls" hidden>
        <select id="site-select" aria-label="当前站点"></select>
      <div class="site-actions"><button id="add-site" type="button">新建静态站点</button><button id="add-cms" type="button">新建 CMS</button><button id="provision-site" type="button">一键建站</button><button id="site-health" type="button">检查健康</button><button id="trigger-build" type="button">触发构建</button><button id="remote-articles" type="button">远程文章</button></div>
        <div id="health-panel" class="health-panel" hidden aria-live="polite"></div>
        <div id="remote-panel" class="remote-panel" hidden aria-live="polite"></div>
      </div>
      <input id="search" type="search" placeholder="搜索标题、标签或分类">
      <div id="article-list" aria-live="polite"><div class="empty">正在加载…</div></div>
    </aside>
    <section class="editor">
      <div class="editor-card">
        <form id="editor-form">
          <input id="title" name="title" placeholder="文章标题" required>
          <div class="metadata-grid">
            <label>标签（逗号分隔）<input id="tags" name="tags" placeholder="写作, Markdown"></label>
            <label>分类（逗号分隔）<input id="categories" name="categories" placeholder="随笔"></label>
            <label>Slug<input id="slug" name="slug" placeholder="留空使用默认规则"></label>
            <label>封面 URL<input id="cover" name="cover" type="url" placeholder="https://…"></label>
            <label>模板 ID<input id="template-id" name="templateId" placeholder="站点模板 ID"></label>
            <label>卷宗<input id="volume" name="volume" placeholder="可选分组"></label>
            <label>计划发布时间<input id="schedule-at" name="scheduleAt" type="datetime-local"></label>
            <label>类型<select id="kind" name="kind"><option value="post">文章</option><option value="page">页面</option></select></label>
            <label class="published-field"><input id="published" name="published" type="checkbox"> 已发布</label>
          </div>
          <div class="editor-tools">
            <button id="format-markdown" type="button">格式化 Markdown</button>
            <button id="find-replace" type="button">查找替换</button>
            <button id="toggle-toc" type="button">显示目录</button>
            <small id="preview-status">预览就绪</small>
          </div>
          <textarea id="body" name="body" placeholder="使用 Markdown 开始写作…"></textarea>
        <div class="editor-actions">
          <span id="status">选择文章或新建草稿</span>
            <div class="right">
              <button id="export" type="button" disabled>导出</button>
              <button id="snapshots-button" type="button" disabled>版本</button>
              <button id="publish" type="button" disabled>发布</button>
              <button id="delete" type="button" class="danger" disabled>移入回收站</button>
              <button id="save" type="submit" class="primary">保存草稿</button>
            </div>
        </div>
        </form>
        <h2>实时预览</h2>
        <div id="toc-panel" hidden aria-live="polite"></div>
        <div id="preview" aria-live="polite">选择文章后显示 Markdown 预览</div>
        <div id="snapshots" hidden aria-live="polite"></div>
        <div id="library-panel" class="library-panel" hidden aria-live="polite"></div>
        ${renderToolsPanel()}
        <div id="ai-panel" class="library-panel" hidden aria-live="polite">
          <h3>快捷写作 AI</h3>
          <div class="library-actions">
            <select id="ai-action"><option value="polish">润色</option><option value="continue">续写</option><option value="summary">摘要</option><option value="outline">大纲</option><option value="code">代码</option><option value="rewrite-selection">改写</option></select>
            <input id="ai-instruction" placeholder="额外要求（可选）">
            <button id="run-ai" type="button">运行</button>
          </div>
          <pre id="ai-output" class="remote-content">选择动作后运行</pre>
        </div>
        <div id="settings-panel" class="library-panel" hidden aria-live="polite"><h3>公开设置</h3><div class="metadata-grid"><label>语言<select id="settings-language"><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label><label>代理 URL（不含账号密码）<input id="settings-proxy" placeholder="http://127.0.0.1:7890"></label></div><button id="save-settings" class="primary" type="button">保存设置</button><small id="settings-status"></small></div>
      </div>
    </section>
  </main>
  <script>
    const state = { articles: [], trash: [], selected: null, view: 'articles' };
    const $ = (selector) => document.querySelector(selector);
    const list = $('#article-list');
    const title = $('#title');
    const body = $('#body');
    const tags = $('#tags');
    const categories = $('#categories');
    const slug = $('#slug');
    const cover = $('#cover');
    const templateId = $('#template-id');
    const volume = $('#volume');
    const scheduleAt = $('#schedule-at');
    const kind = $('#kind');
    const published = $('#published');
    const status = $('#status');
    const preview = $('#preview');
    const tocPanel = $('#toc-panel');
    const previewStatus = $('#preview-status');
    const formatMarkdownButton = $('#format-markdown');
    const findReplaceButton = $('#find-replace');
    const toggleTocButton = $('#toggle-toc');
    const deleteButton = $('#delete');
    const exportButton = $('#export');
    const snapshotsButton = $('#snapshots-button');
    const snapshots = $('#snapshots');
    const publishButton = $('#publish');
    const importButton = $('#import');
    const importFile = $('#import-file');
    const sitesButton = $('#sites-button');
    const siteControls = $('#site-controls');
    const siteSelect = $('#site-select');
    const addSiteButton = $('#add-site');
    const addCmsButton = $('#add-cms');
    const provisionSiteButton = $('#provision-site');
    const siteHealthButton = $('#site-health');
    const triggerBuildButton = $('#trigger-build');
    const healthPanel = $('#health-panel');
    const remoteArticlesButton = $('#remote-articles');
    const remotePanel = $('#remote-panel');
    const libraryButton = $('#library-button');
    const libraryPanel = $('#library-panel');
    const aiButton = $('#ai-button');
    const aiPanel = $('#ai-panel');
    const aiAction = $('#ai-action');
    const aiInstruction = $('#ai-instruction');
    const runAi = $('#run-ai');
    const aiOutput = $('#ai-output');
    const settingsButton = $('#settings-button'); const settingsPanel = $('#settings-panel'); const settingsLanguage = $('#settings-language'); const settingsProxy = $('#settings-proxy'); const saveSettings = $('#save-settings'); const settingsStatus = $('#settings-status');
    state.sites = [];
    state.activeSiteId = null;
    const search = $('#search');
    const trashButton = $('#trash');
    const backToDraftsButton = $('#back-to-drafts');

    function showError(error) { status.textContent = error instanceof Error ? error.message : String(error); }
    function escapeHtml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
    let previewRequest = 0;
    function renderToc(entries) {
      tocPanel.replaceChildren();
      if (!entries.length) { tocPanel.hidden = true; toggleTocButton.disabled = true; return; }
      toggleTocButton.disabled = false;
      const heading = document.createElement('h3'); heading.textContent = '目录'; tocPanel.append(heading);
      entries.forEach((entry) => { const link = document.createElement('a'); link.href = '#' + entry.anchor; link.dataset.level = String(entry.level); link.textContent = entry.text; tocPanel.append(link); });
    }
    async function refreshPreview(markdown) {
      const requestId = ++previewRequest;
      previewStatus.textContent = '预览更新中…';
      try {
        const value = await request('/api/markdown/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown }) });
        if (requestId !== previewRequest) return;
        preview.innerHTML = value.html || '<p>（正文为空）</p>';
        renderToc(value.toc || []);
        previewStatus.textContent = '预览就绪';
      } catch (error) {
        if (requestId !== previewRequest) return;
        preview.textContent = '预览失败：' + (error instanceof Error ? error.message : String(error));
        previewStatus.textContent = '预览失败';
      }
    }
    function splitList(value) { return value.split(',').map((item) => item.trim()).filter(Boolean).filter((item, index, values) => values.indexOf(item) === index); }
    function localDateTimeValue(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.valueOf())) return '';
      const pad = (number) => String(number).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }
    async function request(url, options) {
      const response = await fetch(url, options);
      if (!response.ok) {
        let message = '请求失败';
        try { message = (await response.json()).error || message; } catch (_) { /* keep default */ }
        throw new Error(message);
      }
      return response.status === 204 ? undefined : response.json();
    }
    async function loadSites() {
      try {
        const value = await request('/api/sites');
        state.sites = value.sites || [];
        state.activeSiteId = value.activeSiteId || state.sites[0]?.id || null;
        siteSelect.replaceChildren();
        state.sites.forEach((site) => { const option = document.createElement('option'); option.value = site.id; option.textContent = site.name + ' · ' + site.kind; option.selected = site.id === state.activeSiteId; siteSelect.append(option); });
        siteControls.hidden = false;
        updatePublishAvailability();
      } catch (_) {
        siteControls.hidden = true;
      }
    }
    async function loadHealth() {
      try {
        const values = await request('/api/sites/health');
        healthPanel.hidden = false; healthPanel.replaceChildren();
        values.forEach((item) => {
          const row = document.createElement('div'); row.className = 'health-item';
          const name = document.createElement('span'); name.textContent = (state.sites.find((site) => site.id === item.siteId)?.name || item.siteId);
          const detail = document.createElement('small'); detail.textContent = item.status + (item.error ? ' · ' + item.error : '');
          row.append(name, detail); healthPanel.append(row);
        });
        if (!values.length) { const empty = document.createElement('small'); empty.textContent = '暂无站点'; healthPanel.append(empty); }
      } catch (error) { showError(error); }
    }
    async function loadRemoteArticles() {
      const site = state.sites.find((value) => value.id === state.activeSiteId);
      if (!site || site.kind !== 'static') { showError('远程文章浏览需要先选择静态站点'); return; }
      try {
        const values = await request('/api/sites/' + encodeURIComponent(site.id) + '/remote-articles');
        remotePanel.hidden = false; remotePanel.replaceChildren();
        const heading = document.createElement('strong'); heading.textContent = '远程文章 · ' + site.name; remotePanel.append(heading);
        if (!values.length) { const empty = document.createElement('small'); empty.textContent = '暂无远程 Markdown 文件'; remotePanel.append(empty); return; }
        values.forEach((article) => {
          const item = document.createElement('div'); item.className = 'remote-item';
          const name = document.createElement('strong'); name.textContent = article.path;
          const revision = document.createElement('small'); revision.textContent = article.revision ? 'revision ' + article.revision : '无 revision';
          const actions = document.createElement('div'); actions.className = 'remote-actions';
          const content = document.createElement('pre'); content.className = 'remote-content'; content.hidden = true;
          const open = document.createElement('button'); open.textContent = '打开'; open.onclick = async () => { try { const value = await request('/api/sites/' + encodeURIComponent(site.id) + '/remote-articles/content?path=' + encodeURIComponent(article.path)); content.textContent = value.content || ''; content.hidden = false; } catch (error) { showError(error); } };
          const history = document.createElement('button'); history.textContent = '历史'; history.onclick = async () => { try { const values = await request('/api/sites/' + encodeURIComponent(site.id) + '/remote-articles/history?path=' + encodeURIComponent(article.path)); content.textContent = values.map((value) => (value.id || '') + ' · ' + (value.message || '')).join('\\n') || '暂无提交历史'; content.hidden = false; } catch (error) { showError(error); } };
          actions.append(open, history); item.append(name, revision, actions, content); remotePanel.append(item);
        });
      } catch (error) { showError(error); }
    }
    function updatePublishAvailability() { publishButton.disabled = !state.selected || !state.activeSiteId; }
    function formatFromFilename(filename) {
      const extension = filename.toLowerCase().split('.').pop();
      if (extension === 'html' || extension === 'htm') return 'html';
      if (extension === 'docx') return 'docx';
      return 'markdown';
    }
    function toBase64(bytes) {
      let binary = '';
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
      return btoa(binary);
    }
    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    async function exportArticle(format) {
      if (!state.selected) return;
      const response = await fetch('/api/articles/' + encodeURIComponent(state.selected.id) + '?format=' + encodeURIComponent(format));
      if (!response.ok) throw new Error('导出失败');
      const disposition = response.headers.get('content-disposition') || '';
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      const filename = encoded ? decodeURIComponent(encoded[1]) : (state.selected.title || 'untitled') + '.' + format;
      downloadBlob(await response.blob(), filename);
      status.textContent = '已导出 ' + filename;
    }
    async function loadSnapshots() {
      if (!state.selected) return;
      const values = await request('/api/articles/' + encodeURIComponent(state.selected.id) + '/snapshots');
      snapshots.hidden = false;
      snapshots.replaceChildren();
      const heading = document.createElement('h3'); heading.textContent = '版本快照'; snapshots.append(heading);
      if (!values.length) { const empty = document.createElement('small'); empty.textContent = '暂无快照'; snapshots.append(empty); return; }
      values.forEach((snapshot) => {
        const item = document.createElement('div'); item.className = 'snapshot-item';
        const meta = document.createElement('small'); meta.textContent = 'revision ' + snapshot.localRevision + ' · ' + new Date(snapshot.updatedAt).toLocaleString();
        const actions = document.createElement('div'); actions.className = 'snapshot-actions';
        const restore = document.createElement('button'); restore.textContent = '恢复'; restore.onclick = async () => {
          try { const restored = await request('/api/articles/' + encodeURIComponent(state.selected.id) + '/snapshots/' + snapshot.localRevision + '/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: state.selected.localRevision }) }); showArticle(restored); await loadArticles(); showArticle(restored); await loadSnapshots(); } catch (error) { showError(error); }
        };
        const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = '删除'; remove.onclick = async () => {
          if (!confirm('删除该快照后无法恢复，继续吗？')) return;
          try { await request('/api/articles/' + encodeURIComponent(state.selected.id) + '/snapshots/' + snapshot.localRevision, { method: 'DELETE' }); await loadSnapshots(); } catch (error) { showError(error); }
        };
        actions.append(restore, remove); item.append(meta, actions); snapshots.append(item);
      });
    }
    function libraryCard(title, detail) {
      const card = document.createElement('div'); card.className = 'library-card';
      const strong = document.createElement('strong'); strong.textContent = title;
      const small = document.createElement('small'); small.textContent = detail;
      card.append(strong, small); return card;
    }
    async function loadLibrary() {
      const value = await request('/api/library');
      libraryPanel.hidden = false; libraryPanel.replaceChildren();
      const heading = document.createElement('h3'); heading.textContent = '内容资产与写作统计'; libraryPanel.append(heading);
      const actions = document.createElement('div'); actions.className = 'library-actions';
      const newTemplate = document.createElement('button'); newTemplate.textContent = '新建模板'; newTemplate.onclick = async () => {
        const name = prompt('模板名称', '我的模板'); if (!name) return;
        try { await request('/api/library/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, framework: 'hexo', kind: 'post', frontMatter: 'title: {{title}}\\ndate: {{date}}' }) }); await loadLibrary(); } catch (error) { showError(error); }
      };
      const newSnippet = document.createElement('button'); newSnippet.textContent = '新建片段'; newSnippet.onclick = async () => {
        const name = prompt('片段名称', '我的片段'); const snippetBody = name && prompt('片段内容', '> 内容'); if (!name || snippetBody === null) return;
        try { await request('/api/library/snippets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, body: snippetBody, tags: [] }) }); await loadLibrary(); } catch (error) { showError(error); }
      };
      const newVolume = document.createElement('button'); newVolume.textContent = '新建卷宗'; newVolume.onclick = async () => {
        const name = prompt('卷宗名称', '第一卷'); if (!name) return;
        try { await request('/api/library/volumes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); await loadLibrary(); } catch (error) { showError(error); }
      };
      const recompute = document.createElement('button'); recompute.textContent = '重算统计'; recompute.onclick = async () => { try { await request('/api/library/stats/recompute', { method: 'POST' }); await loadLibrary(); } catch (error) { showError(error); } };
      actions.append(newTemplate, newSnippet, newVolume, recompute); libraryPanel.append(actions);
      const stats = document.createElement('div'); stats.className = 'library-grid';
      stats.append(libraryCard('文章数', String(value.stats?.articles ?? 0)), libraryCard('字数', String(value.stats?.totalWords ?? 0)), libraryCard('模板', String(value.templates?.length ?? 0)), libraryCard('片段', String(value.snippets?.length ?? 0)));
      libraryPanel.append(stats);
      const details = document.createElement('div'); details.className = 'library-grid';
      (value.templates || []).forEach((item) => details.append(libraryCard('模板 · ' + item.name, item.framework + ' · ' + item.kind + ' · v' + item.version)));
      (value.snippets || []).forEach((item) => details.append(libraryCard('片段 · ' + item.name, item.tags?.join(', ') || '无标签')));
      (value.volumes || []).forEach((item) => details.append(libraryCard('卷宗 · ' + item.name, String(item.articleIds?.length || 0) + ' 篇文章')));
      libraryPanel.append(details);
    }
    function renderList() {
      list.replaceChildren();
      const values = state.view === 'trash' ? state.trash : state.articles;
      if (!values.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = state.view === 'trash' ? '回收站为空' : '暂无草稿'; list.append(empty); return; }
      values.forEach((article) => {
        if (state.view === 'trash') {
          const item = document.createElement('div'); item.className = 'article-item';
          const name = document.createElement('strong'); name.textContent = article.title || '未命名文章';
          const meta = document.createElement('small'); meta.textContent = 'revision ' + article.localRevision + ' · 已删除';
          const restore = document.createElement('button'); restore.textContent = '恢复'; restore.onclick = async () => { try { await request('/api/trash/' + encodeURIComponent(article.id) + '/restore', { method: 'POST' }); await loadTrash(); await loadArticles(); } catch (error) { showError(error); } };
          const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = '永久删除'; remove.onclick = async () => { if (!confirm('永久删除后无法恢复，继续吗？')) return; try { await request('/api/trash/' + encodeURIComponent(article.id) + '/delete', { method: 'DELETE' }); await loadTrash(); } catch (error) { showError(error); } };
          item.append(name, meta, restore, remove); list.append(item); return;
        }
        const button = document.createElement('button');
        button.className = 'article-item' + (state.selected && state.selected.id === article.id ? ' selected' : '');
        const name = document.createElement('strong'); name.textContent = article.title || '未命名文章';
        const meta = document.createElement('small'); meta.textContent = 'revision ' + article.localRevision + ' · ' + new Date(article.updatedAt).toLocaleString();
        button.append(name, meta); button.onclick = () => selectArticle(article.id); list.append(button);
      });
    }
    function showArticle(article) {
      state.selected = article;
      title.value = article.title || '';
      body.value = article.body || '';
      tags.value = (article.metadata?.tags || []).join(', ');
      categories.value = (article.metadata?.categories || []).join(', ');
      slug.value = article.metadata?.slug || '';
      cover.value = article.metadata?.cover || '';
      templateId.value = article.metadata?.templateId || '';
      volume.value = article.volume || '';
      scheduleAt.value = localDateTimeValue(article.scheduleAt);
      kind.value = article.metadata?.kind || 'post';
      published.checked = Boolean(article.published);
      status.textContent = '已保存 · revision ' + article.localRevision;
      deleteButton.disabled = false;
      exportButton.disabled = false;
      snapshotsButton.disabled = false;
      updatePublishAvailability();
      snapshots.hidden = true;
      void refreshPreview(article.body || '');
      renderList();
    }
    async function loadArticles() {
      try { state.view = 'articles'; state.articles = await request('/api/articles?text=' + encodeURIComponent(search.value)); backToDraftsButton.hidden = true; trashButton.hidden = false; renderList(); }
      catch (error) { showError(error); }
    }
    async function loadTrash() {
      try { state.view = 'trash'; state.trash = await request('/api/trash'); backToDraftsButton.hidden = false; trashButton.hidden = true; renderList(); }
      catch (error) { showError(error); }
    }
    async function selectArticle(id) {
      try { showArticle(await request('/api/articles/' + encodeURIComponent(id))); }
      catch (error) { showError(error); }
    }
    function startNew() {
      state.view = 'articles'; state.selected = null; title.value = ''; body.value = ''; tags.value = ''; categories.value = ''; slug.value = ''; cover.value = ''; templateId.value = ''; volume.value = ''; scheduleAt.value = ''; kind.value = 'post'; published.checked = false; status.textContent = '新草稿'; deleteButton.disabled = true; exportButton.disabled = true; snapshotsButton.disabled = true; publishButton.disabled = true; snapshots.hidden = true; void refreshPreview(''); renderList(); title.focus();
    }
    $('#editor-form').onsubmit = async (event) => {
      event.preventDefault();
      const payload = { title: title.value, body: body.value, metadata: { tags: splitList(tags.value), categories: splitList(categories.value), slug: slug.value.trim() || undefined, cover: cover.value.trim() || undefined, templateId: templateId.value.trim() || undefined, kind: kind.value, extraFrontMatter: state.selected?.metadata?.extraFrontMatter || {} }, volume: volume.value.trim() || undefined, scheduleAt: scheduleAt.value ? new Date(scheduleAt.value).toISOString() : undefined, published: published.checked };
      try {
        const article = state.selected
          ? await request('/api/articles/' + encodeURIComponent(state.selected.id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, expectedRevision: state.selected.localRevision }) })
          : await request('/api/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        showArticle(article); await loadArticles(); showArticle(article);
      } catch (error) { showError(error); }
    };
    deleteButton.onclick = async () => {
      if (!state.selected || !confirm('确定把这篇文章移入回收站吗？')) return;
      try { await request('/api/articles/' + encodeURIComponent(state.selected.id), { method: 'DELETE' }); startNew(); await loadArticles(); }
      catch (error) { showError(error); }
    };
    $('#new-article').onclick = startNew;
    importButton.onclick = () => importFile.click();
    importFile.onchange = async () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      try {
        status.textContent = '正在导入…';
        const bytes = new Uint8Array(await file.arrayBuffer());
        const article = await request('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: formatFromFilename(file.name), filename: file.name, bytesBase64: toBase64(bytes) }) });
        await loadArticles(); showArticle(article); status.textContent = '已导入 · revision ' + article.localRevision;
      } catch (error) { showError(error); } finally { importFile.value = ''; }
    };
    exportButton.onclick = async () => {
      const format = prompt('输入导出格式：markdown、html、pdf、docx、epub 或 png', 'markdown');
      if (!format || !['markdown', 'html', 'pdf', 'docx', 'epub', 'png'].includes(format.toLowerCase())) return;
      try { await exportArticle(format.toLowerCase()); } catch (error) { showError(error); }
    };
    snapshotsButton.onclick = async () => { try { await loadSnapshots(); } catch (error) { showError(error); } };
    sitesButton.onclick = async () => { siteControls.hidden = !siteControls.hidden; if (!siteControls.hidden) await loadSites(); };
    libraryButton.onclick = async () => { if (libraryPanel.hidden) { try { await loadLibrary(); } catch (error) { showError(error); } } else libraryPanel.hidden = true; };
    aiButton.onclick = () => { aiPanel.hidden = !aiPanel.hidden; };
    settingsButton.onclick = async () => { settingsPanel.hidden = !settingsPanel.hidden; if (settingsPanel.hidden) return; try { const value = await request('/api/settings'); settingsLanguage.value = value.language || 'zh-CN'; settingsProxy.value = value.proxyUrl || ''; } catch (error) { showError(error); } };
    saveSettings.onclick = async () => { try { await request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'standard', pinned: [], hidden: [], theme: 'system', editorTheme: 'default', nightMode: false, language: settingsLanguage.value, proxyUrl: settingsProxy.value.trim() }) }); settingsStatus.textContent = '已保存'; } catch (error) { showError(error); settingsStatus.textContent = error.message || String(error); } };
    runAi.onclick = async () => { if (!body.value.trim()) { showError('请先输入文章正文'); return; } aiOutput.textContent = '正在生成…'; aiPanel.hidden = false; try { const value = await request('/api/ai/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: aiAction.value, text: body.value, instruction: aiInstruction.value }) }); aiOutput.textContent = value.text || '模型没有返回内容'; } catch (error) { showError(error); aiOutput.textContent = error.message || String(error); } };
    siteSelect.onchange = async () => { try { state.activeSiteId = siteSelect.value; await request('/api/sites/' + encodeURIComponent(state.activeSiteId) + '/active', { method: 'POST' }); updatePublishAvailability(); } catch (error) { showError(error); } };
    addSiteButton.onclick = async () => {
      const id = prompt('站点 ID（字母、数字、_、-）', 'my-site');
      const name = id && prompt('站点名称', id);
      const repository = name && prompt('仓库（owner/repo）', 'owner/repo');
      if (!id || !name || !repository) return;
      try {
        await request('/api/sites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name, kind: 'static', isDefault: state.sites.length === 0, config: { provider: 'generic', repository, branch: 'main', postPath: 'posts', pagePath: 'pages', framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } }) });
        await loadSites();
      } catch (error) { showError(error); }
    };
    addCmsButton.onclick = async () => {
      const id = prompt('CMS 站点 ID（字母、数字、_、-）', 'my-cms');
      const name = id && prompt('CMS 站点名称', id);
      const baseUrl = name && prompt('CMS 地址（HTTPS）', 'https://cms.example.com');
      const cmsKind = baseUrl && prompt('类型：wordpress、ghost、typecho-secure、typecho-fastapi 或 typecho-restful', 'wordpress');
      if (!id || !name || !baseUrl || !cmsKind) return;
      try {
        await request('/api/sites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name, kind: 'cms', isDefault: state.sites.length === 0, url: baseUrl, config: { cmsKind, baseUrl, ignoreSsl: false, adapterOptions: {} } }) });
        await loadSites();
      } catch (error) { showError(error); }
    };
    provisionSiteButton.onclick = async () => {
      const provider = prompt('建站 provider：github 或 gitlab', 'github');
      const owner = provider && prompt('仓库 owner / namespace', 'owner');
      const repository = owner && prompt('仓库名称', 'tuomo-site');
      const framework = repository && prompt('框架', 'hexo');
      const mode = framework && prompt('模式：pages 或 cloudflare', 'pages');
      const welcomePost = mode && prompt('欢迎文章 Markdown', '# Welcome\\n\\n由拓墨创建。');
      if (!provider || !owner || !repository || !framework || !mode || welcomePost === null || welcomePost === undefined) return;
      try {
        const result = await request('/api/sites/provision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, owner, repository, framework, mode, welcomePost }) });
        if (result.ok) { status.textContent = '建站完成：' + (result.url || result.repositoryId || ''); await loadSites(); } else status.textContent = '建站失败，已回滚：' + (result.error || '未知错误');
      } catch (error) { showError(error); }
    };
    siteHealthButton.onclick = loadHealth;
    triggerBuildButton.onclick = async () => { const site = state.sites.find((value) => value.id === state.activeSiteId); if (!site || site.kind !== 'static') { showError('请先选择静态站点'); return; } try { const result = await request('/api/sites/' + encodeURIComponent(site.id) + '/build', { method: 'POST' }); status.textContent = '已触发构建：' + result.triggered + ' 个 Hook'; } catch (error) { showError(error); } };
    remoteArticlesButton.onclick = loadRemoteArticles;
    publishButton.onclick = async () => {
      if (!state.selected || !state.activeSiteId) return;
      const site = state.sites.find((value) => value.id === state.activeSiteId);
      if (!site) return;
      try {
        if (site.kind === 'cms') {
          const targets = state.sites.filter((value) => value.kind === 'cms').map((value) => value.id);
          const result = await request('/api/articles/' + encodeURIComponent(state.selected.id) + '/publish/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteIds: targets, kind: 'cms' }) });
          status.textContent = result.results?.every((value) => value.ok) ? 'CMS 多站点发布成功' : 'CMS 发布完成，存在失败站点';
          return;
        }
        const previewResult = await request('/api/articles/' + encodeURIComponent(state.selected.id) + '/publish/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteIds: [site.id] }) });
        const item = previewResult[0];
        if (item.issues?.some((issue) => issue.level === 'error')) throw new Error(item.issues.map((issue) => issue.message).join('；'));
        const message = item.diff?.changed ? '确认发布到 ' + site.name + '？新增 ' + item.diff.additions + ' 行，删除 ' + item.diff.deletions + ' 行。' : '远端内容未变化，仍要发布吗？';
        if (!confirm(message)) return;
        const result = await request('/api/articles/' + encodeURIComponent(state.selected.id) + '/publish/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteIds: [site.id], kind: site.kind, confirmed: true }) });
        status.textContent = result.results?.[0]?.ok ? '发布成功' : '发布失败';
      } catch (error) { showError(error); }
    };
    body.oninput = () => { void refreshPreview(body.value); status.textContent = state.selected ? '有未保存修改' : '新草稿'; };
    title.oninput = () => { if (state.selected) status.textContent = '有未保存修改'; };
    [tags, categories, slug, cover, templateId, volume, scheduleAt, kind, published].forEach((control) => control.addEventListener('input', () => { if (state.selected) status.textContent = '有未保存修改'; }));
    trashButton.onclick = loadTrash;
    backToDraftsButton.onclick = loadArticles;
    search.oninput = () => { state.view = 'articles'; loadArticles(); };
    formatMarkdownButton.onclick = async () => {
      try {
        const value = await request('/api/markdown/format', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: body.value }) });
        body.value = value.markdown; body.dispatchEvent(new Event('input')); status.textContent = state.selected ? '有未保存修改' : '新草稿';
      } catch (error) { showError(error); }
    };
    findReplaceButton.onclick = async () => {
      const searchText = prompt('查找内容', ''); if (!searchText) return;
      const replacement = prompt('替换为', ''); if (replacement === null) return;
      try {
        const value = await request('/api/markdown/replace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: body.value, search: searchText, replacement, caseSensitive: confirm('区分大小写？'), wholeWord: confirm('仅替换完整单词？') }) });
        body.value = value.markdown; body.dispatchEvent(new Event('input')); status.textContent = state.selected ? '有未保存修改' : '新草稿';
      } catch (error) { showError(error); }
    };
    toggleTocButton.onclick = () => { if (!toggleTocButton.disabled) { tocPanel.hidden = !tocPanel.hidden; toggleTocButton.textContent = tocPanel.hidden ? '显示目录' : '隐藏目录'; } };
    ${renderToolsScript()}
    loadArticles(); loadSites();
  </script>
</body>
</html>`;
}

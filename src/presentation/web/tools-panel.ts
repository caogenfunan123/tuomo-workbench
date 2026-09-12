/** Small progressive-enhancement panel for the reference Web host. */
export function renderToolsPanel(): string {
  return `<div id="tools-panel" class="library-panel" hidden aria-live="polite">
    <h3>辅助工具</h3>
    <div class="library-actions">
      <input id="rss-url" type="url" placeholder="RSS / Atom 地址">
      <button id="refresh-rss" type="button">刷新 RSS</button>
    </div>
    <div class="library-actions">
      <button id="check-links" type="button">检查当前文章链接</button>
      <input id="tool-image" type="file" accept="image/*">
      <button id="upload-image" type="button">上传图片并插入</button>
      <button id="retry-image" type="button" disabled>重试上次图片</button>
    </div>
    <div class="library-actions">
      <input id="batch-files" type="file" multiple webkitdirectory directory>
      <button id="batch-upload" type="button">批量上传文件夹</button>
      <button id="clear-cache" type="button">清理缓存</button>
    </div>
    <pre id="tools-output" class="remote-content">选择工具后显示结果</pre>
  </div>`;
}

export function renderToolsScript(): string {
  return [
    "const toolsButton = document.querySelector('#tools-button');",
    "const toolsPanel = document.querySelector('#tools-panel');",
    "const rssUrl = document.querySelector('#rss-url');",
    "const refreshRss = document.querySelector('#refresh-rss');",
    "const checkLinks = document.querySelector('#check-links');",
    "const toolImage = document.querySelector('#tool-image');",
    "const uploadImage = document.querySelector('#upload-image');",
    "const retryImage = document.querySelector('#retry-image');",
    "const batchFiles = document.querySelector('#batch-files');",
    "const batchUpload = document.querySelector('#batch-upload');",
    "const clearCache = document.querySelector('#clear-cache');",
    "const toolsOutput = document.querySelector('#tools-output');",
    "let imageRetry = null;",
    "function showToolOutput(value) { toolsOutput.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); toolsPanel.hidden = false; }",
    "async function sendImageUpload(payload) { const value = await request('/api/tools/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); if (value.ok && value.result?.markdownUrl) { imageRetry = null; retryImage.disabled = true; body.value += (body.value && !body.value.endsWith('\\n') ? '\\n' : '') + '![](' + value.result.markdownUrl + ')'; body.dispatchEvent(new Event('input')); showToolOutput('上传成功：\\n' + value.result.markdownUrl); } else { imageRetry = value.retry || payload; retryImage.disabled = false; showToolOutput(value.error || '上传失败，可重试'); } }",
    "toolsButton.onclick = () => { toolsPanel.hidden = !toolsPanel.hidden; };",
    "refreshRss.onclick = async () => { const url = rssUrl.value.trim(); if (!url) return; showToolOutput('正在刷新 RSS…'); try { const values = await request('/api/tools/rss?url=' + encodeURIComponent(url)); showToolOutput(values.map((item) => (item.title || '未命名') + (item.link ? '\\n' + item.link : '')).join('\\n\\n') || '没有可显示的条目'); } catch (error) { showError(error); showToolOutput(error.message || String(error)); } };",
    "checkLinks.onclick = async () => { showToolOutput('正在检查链接…'); try { const value = await request('/api/tools/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: body.value }) }); showToolOutput(value.results.map((item) => (item.ok ? '✓ ' : '✗ ') + item.url + (item.status ? ' · ' + item.status : item.error ? ' · ' + item.error : '')).join('\\n') || '当前文章没有 HTTP 链接'); } catch (error) { showError(error); showToolOutput(error.message || String(error)); } };",
    "uploadImage.onclick = async () => { const file = toolImage.files && toolImage.files[0]; if (!file) return; showToolOutput('正在上传图片…'); try { const bytes = new Uint8Array(await file.arrayBuffer()); imageRetry = { siteId: state.activeSiteId, filename: file.name, mimeType: file.type || 'application/octet-stream', bytesBase64: toBase64(bytes) }; retryImage.disabled = true; await sendImageUpload(imageRetry); } catch (error) { imageRetry = imageRetry || null; retryImage.disabled = !imageRetry; showError(error); showToolOutput(error.message || String(error)); } finally { toolImage.value = ''; } };",
    "retryImage.onclick = async () => { if (!imageRetry) return; showToolOutput('正在重试图片上传…'); try { await sendImageUpload(imageRetry); } catch (error) { retryImage.disabled = false; showError(error); showToolOutput(error.message || String(error)); } };",
    "batchUpload.onclick = async () => { const files = batchFiles.files ? Array.from(batchFiles.files) : []; if (!files.length) return; showToolOutput('正在准备批量上传…'); try { const values = []; for (const file of files) values.push({ path: file.webkitRelativePath || file.name, bytesBase64: toBase64(new Uint8Array(await file.arrayBuffer())) }); const result = await request('/api/tools/batch-upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteId: state.activeSiteId, files: values }) }); showToolOutput(result.results.map((item) => item.path + ' · ' + item.method + (item.error ? ' · ' + item.error : '')).join('\\n') + (result.cancelled ? '\\n已取消' : '')); } catch (error) { showError(error); showToolOutput(error.message || String(error)); } finally { batchFiles.value = ''; } };",
    "clearCache.onclick = async () => { try { const value = await request('/api/tools/cache/clear', { method: 'POST' }); showToolOutput('已清理缓存条目：' + value.cleared); } catch (error) { showError(error); showToolOutput(error.message || String(error)); } };",
  ].join('\n');
}

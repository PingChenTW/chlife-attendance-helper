import { parseGroupContext, applyGroupContext, groupHref } from './group-context.js';

// This guide reads no attendance data and works without starting the backend.
const context = parseGroupContext(window.location.search);
applyGroupContext(context, document);
const start = document.getElementById('help-start');
const subtitle = document.querySelector('.brand small');
if (context.id) {
  start.textContent = `返回${context.label}點名 →`;
  start.href = groupHref('./', context);
  subtitle.textContent = `${context.label} · 使用說明`;
  document.querySelector(`.group-entrances a[href="./?group=${context.id}"]`)?.setAttribute('aria-current', 'true');
} else {
  for (const link of document.querySelectorAll('.brand,.page-nav a:not([aria-current])')) link.href = '#groups';
  subtitle.textContent = '簡單四步，完成點名';
}

const share = document.getElementById('share-help');
const status = document.getElementById('share-status');
const urlField = document.getElementById('share-url');
const url = new URL(window.location.pathname, window.location.origin);
if (context.id) url.searchParams.set('group', context.id);
urlField.value = url.href;
share.hidden = false;
share.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(url.href);
    status.textContent = '連結已複製，貼到 LINE 就能分享。';
  } catch {
    document.getElementById('share-url-label').hidden = false;
    urlField.hidden = false;
    urlField.focus(); urlField.select();
    status.textContent = '請複製下方網址，再貼到 LINE 分享。';
  }
});

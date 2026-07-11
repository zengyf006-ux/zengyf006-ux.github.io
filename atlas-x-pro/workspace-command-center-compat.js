(() => {
  'use strict';
  if (window.__ATLAS_WORKSPACE_COMPAT__) return;
  window.__ATLAS_WORKSPACE_COMPAT__ = true;

  const isEditable = element => element instanceof HTMLElement
    && Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.querySelector('#workspaceCommandDialog:not([hidden]), #workspacePanel:not([hidden])')) return;
    const active = document.activeElement;
    if (!isEditable(active)) return;
    active.blur();
    document.documentElement.dataset.workspaceInputMode = 'false';
  }, true);

  document.addEventListener('focusin', event => {
    if (isEditable(event.target)) document.documentElement.dataset.workspaceInputMode = 'true';
  });
  document.addEventListener('focusout', () => {
    queueMicrotask(() => {
      document.documentElement.dataset.workspaceInputMode = String(isEditable(document.activeElement));
    });
  });
})();

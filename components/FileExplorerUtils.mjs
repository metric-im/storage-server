export function safe(seg) {
  return encodeURIComponent(seg);
}

export function disableToolbar(disabled) {
  if (this.newFolderBtnComponent) this.newFolderBtnComponent.working = disabled;
  if (this.uploadBtnComponent) this.uploadBtnComponent.working = disabled;
}

export function makeCrumb(label, onclick) {
  const c = document.createElement('span');
  c.classList.add('crumb');
  c.textContent = label;
  c.onclick = onclick;
  c.tabIndex = 0;
  c.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') onclick();
  });
  return c;
}
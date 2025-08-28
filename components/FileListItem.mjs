import Component from './Component.mjs';

export default class FileListItem extends Component {
  constructor(props) {
    super(props);
  }

  async render(element) {
    await super.render(element);

    const { item, onSelect, onDelete } = this.props;
    const { name, isDir, meta, optimistic } = item;

    this.element.classList.add('file-item', isDir ? 'dir' : 'file');

    if (optimistic) {
      this.element.classList.add('optimistic');
      this.element.title = "Pending operation...";
    }
    this.element.tabIndex = 0;

    const iconSpan = document.createElement('span');
    iconSpan.classList.add('icon');
    if (isDir) {
      iconSpan.classList.add('icon-folder');
    } else {
      iconSpan.classList.add('icon-text-document');
    }

    const mainContent = document.createElement('div');
    mainContent.classList.add('file-item-main-content');
    mainContent.append(iconSpan);

    const label = document.createElement('span');
    label.textContent = name;
    label.classList.add('file-name-text');
    mainContent.append(label);

    if (optimistic) {
      const pendingText = document.createElement('span');
      pendingText.textContent = ' (pending...)';
      pendingText.style.fontSize = '0.8em';
      pendingText.style.color = '#666';
      label.append(pendingText);
    }

    if (!isDir && meta && meta.size !== undefined) {
      const sizeSpan = document.createElement('span');
      sizeSpan.textContent = `(${ (meta.size / 1024).toFixed(2) } KB)`;
      sizeSpan.classList.add('file-size-text');
      mainContent.append(sizeSpan);
    }

    this.element.append(mainContent);

    this.element.onclick = () => onSelect(item);
    this.element.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') onSelect(item);
    });

    const actionsContainer = document.createElement('div');
    actionsContainer.classList.add('actions');

    const del = document.createElement('span');
    del.textContent = 'Delete';
    del.classList.add('delete-icon');

    del.onclick = async e => {
      e.stopPropagation();
      onDelete(item);
    };
    actionsContainer.append(del);
    this.element.append(actionsContainer);
  }
}
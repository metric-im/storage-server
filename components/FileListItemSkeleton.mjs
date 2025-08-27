import Component from './Component.mjs';

export default class FileListItemSkeleton extends Component {
  constructor(props) {
    super(props);
  }

  async render(element) {
    await super.render(element);
    this.element.classList.add('file-item-skeleton');

    const mainContent = document.createElement('div');
    mainContent.classList.add('skeleton-main-content');
    this.element.append(mainContent);

    const icon = document.createElement('div');
    icon.classList.add('skeleton-icon', 'skeleton-box');
    mainContent.append(icon);

    const textLine = document.createElement('div');
    textLine.classList.add('skeleton-text-line', 'skeleton-box');
    mainContent.append(textLine);

    const actions = document.createElement('div');
    actions.classList.add('skeleton-actions');
    const actionBtn = document.createElement('div');
    actionBtn.classList.add('skeleton-action-btn', 'skeleton-box');
    actions.append(actionBtn);
    this.element.append(actions);
  }
}
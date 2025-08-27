import Component from './Component.mjs';
import { Button } from './Button.mjs';

export default class FileExplorerToolbar extends Component {
  constructor(props) {
    super(props);
  }

  async render(element) {
    await super.render(element);
    this.element.classList.add('file-toolbar');

    this.newFolderBtn = await this.draw(
      Button,
      {
        title: 'New Folder',
        icon: 'folder',
        onClick: () => this.props.onNewFolder()
      },
      this.element
    );

    this.fileInput = Object.assign(document.createElement('input'), {
      type: 'file',
      multiple: true,
      hidden: true,
      onchange: (e) => {
        this.props.onUploadFiles(e.target.files);
        e.target.value = '';
      }
    });

    this.uploadBtn = await this.draw(
      Button,
      {
        title: 'Upload File',
        icon: 'upload',
        onClick: () => this.fileInput.click()
      },
      this.element
    );

    this.element.append(this.fileInput);

    this.element.ondragover = e => e.preventDefault();
    this.element.ondrop = e => {
      e.preventDefault();
      if (e.dataTransfer) this.props.onUploadFiles(e.dataTransfer.files);
    };
  }
}
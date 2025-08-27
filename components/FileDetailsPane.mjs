import Component from './Component.mjs';
import { InputSelect } from './InputSelect.mjs';
import MediaPresets from '../../../components/MediaPresets.mjs';
import { Button } from './Button.mjs';

export default class FileDetailsPane extends Component {
  constructor(props) {
    // props: { item: {key, meta, name}, baseUrl, renderFilePreview, onDownload, fileSize }
    super(props);
    this.previewContainer = null;
    this.presetSelect = null;
    this.info = null;
    this.downloadButton = null;
  }

  async renderContent() {
    this.element.innerHTML = '';

    const { item, baseUrl, renderFilePreview, onDownload, fileSize } = this.props;

    if (!item) {
      this.previewContainer = null;
      this.presetSelect = null;
      this.info = null;
      this.downloadButton = null;
      return;
    }

    const { key, meta } = item;
    const itemBaseUrl = `${baseUrl}/item/${key}`;
    const mimeType = meta.type || meta.variants?.['']?.type;

    if (!mimeType) {
      this.element.innerHTML = `<p>No preview available (unknown file type). File might be corrupted or metadata missing. Details: ${JSON.stringify(meta)}</p>`;
      this.previewContainer = null;
      this.presetSelect = null;
      this.info = null;
      this.downloadButton = null;
      return;
    }

    this.previewContainer = this.div('detail-preview-container', this.element);
    this.previewContainer.classList.remove('loaded');

    renderFilePreview(this.previewContainer, itemBaseUrl, mimeType, fileSize);

    const options = Object.values(MediaPresets).map(o => ({
      name: o.name,
      value: o._id
    }));
    options.unshift({ name: '(original)', value: '' });

    this.presetSelect = await this.draw(
      InputSelect,
      { name: 'preset', options, hideTitle: true },
      this.element
    );

    if (mimeType && mimeType.startsWith('image/')) {
      this.presetSelect.element.addEventListener('change', () => {
        const selectedPreset = this.presetSelect.value;
        const imgElement = this.previewContainer.querySelector('img');
        if (imgElement) {
          if (selectedPreset) {
            const keyWithoutExtension = key.replace(/\.[^/.]+$/, '');
            imgElement.src = `${baseUrl}/item/${keyWithoutExtension}.${selectedPreset}.png`;
            console.log(`Preset URL: ${imgElement.src}`);
          } else {
            imgElement.src = `${itemBaseUrl}`;
            console.log(`Original URL: ${imgElement.src}`);
          }
        }
      });
    } else {
      this.presetSelect.element.style.display = 'none';
    }

    this.info = document.createElement('div');
    this.info.classList.add('detail-info');
    for (const [k, v] of Object.entries(meta)) {
      if (k === 'variants' || k === '_id') continue;
      const line = document.createElement('div');
      line.textContent = `${k}: ${Array.isArray(v) ? v.join(', ') : v}`;
      this.info.append(line);
    }
    this.element.append(this.info);

    this.downloadButton = await this.draw(
      Button,
      {
        title: 'Download Original',
        icon: 'download',
        onClick: () => onDownload(item)
      },
      this.element
    );
  }

  async render(element) {
    await super.render(element);
    this.element.classList.add('file-details');
    await this.renderContent();
  }

  async updateItem(newProps) {
    Object.assign(this.props, newProps);
    await this.renderContent();
  }
}
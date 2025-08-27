import Component from './Component.mjs';
import API from './API.mjs';
import { Button } from './Button.mjs';
import { InputSelect } from './InputSelect.mjs';
import MediaPresets from '../../../components/MediaPresets.mjs';
import FileExplorerToolbar from './FileExplorerToolbar.mjs';
import FileListItem from './FileListItem.mjs';
import FileListItemSkeleton from './FileListItemSkeleton.mjs';
import FileDetailsPane from './FileDetailsPane.mjs';
import {
  safe,
  disableToolbar,
  makeCrumb
} from './FileExplorerUtils.mjs';
import { renderFilePreview } from './FileExplorerDetailsHelpers.mjs';
import { FileExplorerCache } from './FileExplorerCache.mjs';

const STORE = '/storage';

export default class FileExplorer extends Component {
  constructor(props) {
    super(props);
    this.currentPath = [];
    this._currentItems = [];
    this._cache = new FileExplorerCache();
    this.selectedFileDetails = null;

    this.safe = safe;
    this.disableToolbar = disableToolbar.bind(this);
    this.makeCrumb = makeCrumb;
    this.renderFilePreview = renderFilePreview;

    this.promptNewFolder = this.promptNewFolder.bind(this);
    this.uploadFiles = this.uploadFiles.bind(this);
    this.handleFileSelect = this.handleFileSelect.bind(this);
    this.handleFileDelete = this.handleFileDelete.bind(this);
    this.renderList = this.renderList.bind(this);
    this.deselectFile = this.deselectFile.bind(this);
  }

  async render(element) {
    await super.render(element);

    this.toolbar = this.div('file-toolbar', this.element);
    this.breadcrumb = this.div('breadcrumb', this.element);
    this.listContainer = this.div('file-list', this.element);
    this.detailsPane = this.div('file-details', this.element);

    this.fileExplorerToolbar = await this.draw(
      FileExplorerToolbar,
      {
        onNewFolder: this.promptNewFolder,
        onUploadFiles: this.uploadFiles
      },
      this.toolbar
    );

    const onDownloadHandler = (itemToDownload) => {
      if (!itemToDownload) return;
      const itemBaseUrl = `${STORE}/item/${itemToDownload.key}`;
      const link = document.createElement('a');
      link.href = itemBaseUrl;
      link.download = itemToDownload.key.split('/').pop();
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
  
    this.fileDetailsPane = await this.draw(
      FileDetailsPane,
      {
        item: this.selectedFileDetails,
        baseUrl: `${STORE}`,
        renderFilePreview: this.renderFilePreview,
        onDownload: onDownloadHandler,
        fileSize: null
      },
      this.detailsPane
    );

    this.listContainer.ondragover = e => e.preventDefault();
    this.listContainer.ondrop = e => {
      e.preventDefault();
      if (e.dataTransfer) this.uploadFiles(e.dataTransfer.files);
    };

    await this.load();
  }

  deselectFile() {
    this.fileDetailsPane.updateItem({ item: null, fileSize: null });
    this.selectedFileDetails = null;
  }

  async promptNewFolder() {
    const name = window.prompt('Folder name:');
    if (!name) return;

    const acct = this.safe(this.props.context.id);
    const folder = this.safe(name);
    const fullPathForNewFolder = [...this.currentPath.map(this.safe), folder].filter(Boolean).join('/');
    const url = `${STORE}/list/${acct}${fullPathForNewFolder ? '/' + fullPathForNewFolder : ''}`;
    const optimisticFolderKey = `${acct}/${fullPathForNewFolder}`;
    const optimisticFolder = {
      name: name,
      isDir: true,
      key:optimisticFolderKey,
      optimistic: true,
      _tempId: crypto.randomUUID(),
      meta: {
        _created: new Date().toISOString(),
        type: 'application/x-directory',
      }
    };

    const originalItemsState = [...this._currentItems];
    this._currentItems = [...this._currentItems, optimisticFolder];
    this._currentItems.sort((a, b) => {
      const aIsDir = a.isDir;
      const bIsDir = b.isDir;
      return aIsDir === bIsDir ? a.name.localeCompare(b.name) : (aIsDir ? -1 : 1);
    });
    this.renderList();
    this.disableToolbar(true);

    this.deselectFile();

    try {
      const response = await API.put(url, {}, { headers: { 'Content-Type': 'application/x-directory' } });
      window.toast.success(`Created folder “${name}”`);
      const createdFolderData = response.folder;
      this._cache.updateItemInList(this.currentPath.join('/'), optimisticFolder, createdFolderData);
      const index = this._currentItems.findIndex(item => item._tempId === optimisticFolder._tempId);
      if (index !== -1) {
          this._currentItems[index] = { ...this._currentItems[index], optimistic: false, ...createdFolderData };
      }
      this.renderList();
    } catch (e) {
      window.toast.error(`Failed to create folder: ${e.message}`);
      this._currentItems = originalItemsState.filter(item => item._tempId !== optimisticFolder._tempId);
      this.renderList();
      this._cache.delete(this.currentPath.join('/')); 
    } finally {
      this.disableToolbar(false);
    }
  }

  async uploadFiles(files) {
    const acct = this.safe(this.props.context.id);
    const pathSeg = this.currentPath.map(this.safe).join('/');

    const originalItemsState = [...this._currentItems];
    const optimisticFilesToAdd = [];
    const filesArray = Array.from(files);

    for (const file of filesArray) {
      const fileName = file.name;
      const safeFileName = this.safe(fileName);
      const optimisticFileKey = `${acct}/${pathSeg ? pathSeg + '/' : ''}${safeFileName}`;
      const optimisticFile = {
        name: fileName,
        isDir: false,
        key: optimisticFileKey,
        optimistic: true,
        _tempId: crypto.randomUUID(),
        meta: {
          _created: new Date().toISOString(),
          type: file.type || 'application/octet-stream',
          size: file.size,
        }
      };
      optimisticFilesToAdd.push(optimisticFile);
    }

    this._currentItems = [...this._currentItems, ...optimisticFilesToAdd];
    this._currentItems.sort((a, b) => {
      const aIsDir = a.isDir;
      const bIsDir = b.isDir;
      return aIsDir === bIsDir ? a.name.localeCompare(b.name) : (aIsDir ? -1 : 1);
    });
    this.renderList();

    this.disableToolbar(true);

    this.deselectFile();
    const uploadPromises = filesArray.map(async (file, index) => {
      const optimisticItem = optimisticFilesToAdd[index];
      const nameForUrl = this.safe(file.name);
      const url = `${STORE}/item/${acct}${pathSeg ? '/' + pathSeg : ''}/${nameForUrl}`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name)
          },
          body: file
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error);
        }
        const responseData = await res.json();
        window.toast.success(`Uploaded “${file.name}”`);
        const indexInCurrentItems = this._currentItems.findIndex(item => item._tempId === optimisticItem._tempId);
        if (indexInCurrentItems !== -1) {
            Object.assign(this._currentItems[indexInCurrentItems], { optimistic: false, ...responseData.meta, key: responseData.key }); 
            this._cache.updateItemInList(this.currentPath.join('/'), optimisticItem, { ...responseData.meta, key: responseData.key });
        }
        return { status: 'fulfilled', item: optimisticItem };
      } catch (e) {
        console.error('Upload error:', e);
        window.toast.error(`Upload failed: ${e.message}`);

        this._currentItems = this._currentItems.filter(item => item._tempId !== optimisticItem._tempId);
        const cacheKey = this.currentPath.join('/');
        if (this._cache.has(cacheKey)) {
          let cachedItems = this._cache.get(cacheKey);
          cachedItems = cachedItems.filter(item => item._tempId !== optimisticItem._tempId);
          this._cache.set(cacheKey, cachedItems);
        }

        return { status: 'rejected', reason: e, item: optimisticItem };
      }
    });

    try {
      await Promise.allSettled(uploadPromises);
      this._currentItems.sort((a, b) => {
        const aIsDir = a.isDir;
        const bIsDir = b.isDir;
        return aIsDir === bIsDir ? a.name.localeCompare(b.name) : (aIsDir ? -1 : 1);
      });
      this.renderList();

    } catch (e) {
      console.error('Batch upload process error:', e);
      this._currentItems = originalItemsState;
      this.renderList();
      this._cache.delete(this.currentPath.join('/'));
    } finally {
      this.disableToolbar(false);
    }
  }

  async load() {
    const acct = this.safe(this.props.context.id);
    const pathKey = this.currentPath.join('/');
    const url = `${STORE}/list/${acct}${pathKey ? '/' + pathKey : ''}`;
    const cacheKey = pathKey;

    const numberOfSkeletons = 10;
    for (let i = 0; i < numberOfSkeletons; i++) {
      await this.draw(FileListItemSkeleton, {}, this.listContainer);
    }
    this.disableToolbar(true);
    this.deselectFile();

    if (this._cache.has(cacheKey)) {
      this._currentItems = this._cache.get(cacheKey);
      this.renderBreadcrumb();
      await this.renderList();
      this.disableToolbar(false);
      return;
    }

    try {
      const items = await API.get(url);
      this._currentItems = items;
      this._cache.set(cacheKey, items);
      this.renderBreadcrumb();
      await this.renderList();
    } catch (err) {
      this.listContainer.innerHTML = `<p class="error">Load failed: ${err.message}</p>`;
      this._currentItems = [];
    } finally {
      this.disableToolbar(false);
    }
  }

  renderBreadcrumb() {
    this.breadcrumb.innerHTML = '';
    const root = this.makeCrumb(this.props.context.id, () => {
      this.currentPath = [];
      this.load();
    });
    this.breadcrumb.append(root);
    this.currentPath.forEach((seg, i) => {
      this.breadcrumb.append(document.createTextNode(' / '));
      const c = this.makeCrumb(seg, () => {
        this.currentPath = this.currentPath.slice(0, i + 1);
        this.load();
      });
      this.breadcrumb.append(c);
    });
  }

  async renderList() {
    const items = [...this._currentItems];
    this.listContainer.innerHTML = '';

    items.sort((a, b) => {
      const aIsDir = a.isDir;
      const bIsDir = b.isDir;
      return aIsDir === bIsDir ? a.name.localeCompare(b.name) : (aIsDir ? -1 : 1);
    });

    if (items.length === 0) {
      this.listContainer.innerHTML = '<p>This folder is empty.</p>';
      return;
    }

    for (const item of items) {
      await this.draw(
        FileListItem,
        {
          item: item,
          onSelect: this.handleFileSelect,
          onDelete: this.handleFileDelete
        },
        this.listContainer
      );
    }
  }

  async handleFileSelect(item) {
    if (item.optimistic) {
        window.toast.info(`Operation for "${item.name}" is still pending.`);
        return;
    }

    if (item.isDir) {
      this.deselectFile();
      this.currentPath.push(item.name);
      this.load();
    } else {
      this.fileDetailsPane.updateItem({ item: null, fileSize: null });

      const acct = this.safe(this.props.context.id);
      const url = `/storage/item/meta/${item.key}`;
      try {
        const fullDetails = await API.get(url);
        this.selectedFileDetails = fullDetails;
        const detailsPaneProps = {
          item: this.selectedFileDetails,
          baseUrl: `${STORE}`,
          renderFilePreview: this.renderFilePreview,
          onDownload: (itemToDownload) => {
            if (!itemToDownload) return;
            const itemBaseUrl = `${STORE}/item/${itemToDownload.key}`;
            const link = document.createElement('a');
            link.href = itemBaseUrl;
            link.download = itemToDownload.key.split('/').pop();
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          },
          fileSize: fullDetails.meta.size
        };
        this.fileDetailsPane.updateItem(detailsPaneProps);
      } catch (error) {
        /* GET /storage/item/meta/${item.key} fails for files uploaded 
           before storage-server was implemented. This is because the getMeta() 
           looks for the metadata sidecar `${item.keyBase}._i` which is 
           non-existent for previously uploaded images
        */
        const inferredMimeType = this.inferMimeTypeFromKey(item.key);
        this.selectedFileDetails = {
          ...item,
          meta: {
            ...(item.meta || {}),
            type: inferredMimeType,
            size: item.meta?.size,
            error: error.message
          }
        };

        const detailsPaneProps = {
          item: this.selectedFileDetails,
          baseUrl: `${STORE}`,
          renderFilePreview: this.renderFilePreview,
          onDownload: (itemToDownload) => {
            if (!itemToDownload) return;
            const itemBaseUrl = `${STORE}/item/${itemToDownload.key}`;
            const link = document.createElement('a');
            link.href = itemBaseUrl;
            link.download = itemToDownload.key.split('/').pop();
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          },
          fileSize: this.selectedFileDetails.meta.size
        };
        this.fileDetailsPane.updateItem(detailsPaneProps);
      }
    }
  }

  async handleFileDelete(itemToDelete) {
    if (itemToDelete.optimistic) {
      window.toast.info(`Cannot delete "${itemToDelete.name}" while previous operation is pending.`);
      return;
    }
    if (!await window.toast.prompt(`Delete ${itemToDelete.name}?`)) return;

    const originalItemsState = [...this._currentItems];
    this._currentItems = this._currentItems.filter(i => i.key !== itemToDelete.key);
    this.renderList();
    this.disableToolbar(true);
    this.deselectFile();

    const acct = this.safe(this.props.context.id);
    const fullPathToDelete = [...this.currentPath.map(this.safe), this.safe(itemToDelete.name)].join('/');
    let url;
    if (itemToDelete.isDir) {
      url = `${STORE}/list/${acct}${fullPathToDelete ? '/' + fullPathToDelete : ''}`;
    } else {
      url = `${STORE}/item/${acct}/${fullPathToDelete}`;
    }
    try {
      await fetch(url, { method: 'DELETE' });
      window.toast.success(`Deleted “${itemToDelete.name}”`);
      this._cache.delete(this.currentPath.join('/'));
    } catch (error) {
      window.toast.error(`Delete failed: ${error.message}`);
      this._currentItems = originalItemsState;
      this.renderList();
      this._cache.delete(this.currentPath.join('/'));
    } finally {
      this.disableToolbar(false);
    }
  }

  inferMimeTypeFromKey(key) {
    const ext = key.split('.').pop().toLowerCase();
    switch (ext) {
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'gif': return 'image/gif';
      case 'webp': return 'image/webp';
      case 'mp4': return 'video/mp4';
      case 'webm': return 'video/webm';
      case 'mp3': return 'audio/mpeg';
      case 'wav': return 'audio/wav';
      case 'pdf': return 'application/pdf';
      case 'txt': return 'text/plain';
      case 'csv': return 'text/csv';
      case 'json': return 'application/json';
      case 'xml': return 'application/xml';
      case 'html': return 'text/html';
      case 'css': return 'text/css';
      case 'js': return 'application/javascript';
      default: return 'application/octet-stream';
    }
  }
}
export function renderFilePreview(container, url, mimeType, fileSize) {
  container.innerHTML = '';
  let contentLoaded = false;
  const markContentLoaded = () => {
    if (!contentLoaded) {
      container.classList.add('loaded');
      contentLoaded = true;
    }
  };

  const skeleton = document.createElement('div');
  skeleton.classList.add('skeleton-preview');
  if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
    const skeletonBox = document.createElement('div');
    skeletonBox.classList.add('skeleton-box', 'skeleton-image');
    skeleton.appendChild(skeletonBox);
  } else if (mimeType.startsWith('text/') || mimeType === 'application/pdf') {
    for (let i = 0; i < 3; i++) {
      const textLine = document.createElement('div');
      textLine.classList.add('skeleton-box', 'skeleton-text-line');
      skeleton.appendChild(textLine);
    }
  }
  container.append(skeleton);

  const MAX_PREVIEW_SIZE = 1024 * 1024;

  if (fileSize && fileSize > MAX_PREVIEW_SIZE && mimeType.startsWith('text/')) {
    markContentLoaded();
    const tooLarge = document.createElement('p');
    tooLarge.textContent = `File is too large (${(fileSize / (1024 * 1024)).toFixed(2)} MB) to display a direct text preview. Please download the file to view its content.`;
    container.append(tooLarge);
    return;
  }

  let element;
  if (mimeType.startsWith('image/')) {
    element = document.createElement('img');
    element.src = url;
    element.loading = 'lazy';
    element.alt = `Preview of ${url.split('/').pop()}`;
    element.onload = () => {
      markContentLoaded();
    };
    element.onerror = () => {
      markContentLoaded();
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Could not load image preview.`;
      container.append(errorMsg);
    };
  } else if (mimeType === 'application/pdf') {
    element = document.createElement('iframe');
    element.src = url;
    element.style.width = '100%';
    element.style.height = '500px';
    element.style.border = 'none';
    element.onload = () => {
      markContentLoaded();
    };
    element.onerror = () => {
      markContentLoaded();
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Could not load PDF preview. Your browser might not support direct PDF embedding.`;
      container.append(errorMsg);
    };
  } else if (mimeType.startsWith('video/')) {
    element = document.createElement('video');
    element.src = url;
    element.controls = true;
    element.style.maxWidth = '100%';
    element.style.height = 'auto';
    element.preload = 'metadata';
    element.onloadeddata = () => {
      markContentLoaded();
    };
    element.onerror = () => {
      markContentLoaded();
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Could not load video preview.`;
      container.append(errorMsg);
    };
  } else if (mimeType.startsWith('audio/')) {
    element = document.createElement('audio');
    element.src = url;
    element.controls = true;
    element.style.width = '100%';
    element.preload = 'metadata';
    element.onloadeddata = () => {
      markContentLoaded();
    };
    element.onerror = () => {
      markContentLoaded();
      const errorMsg = document.createElement('p');
      errorMsg.textContent = `Could not load audio preview.`;
      container.append(errorMsg);
    };
  } else if (mimeType.startsWith('text/')) {
    element = document.createElement('pre');
    element.classList.add('text-preview');
    fetch(url)
      .then(response => response.text())
      .then(text => {
        element.textContent = text;
        markContentLoaded();
      })
      .catch(error => {
        element.textContent = `Could not load text file: ${error.message}`;
        markContentLoaded();
        console.error('Error loading text file:', error);
      });
  } else {
    markContentLoaded();
    const noPreview = document.createElement('p');
    noPreview.textContent = `No direct preview available for "${mimeType}" file type.`;
    container.append(noPreview);
    return;
  }

  if (element) {
    element.classList.add('detail-preview');
    element.style.opacity = '0';
    element.style.transition = 'opacity 0.3s ease-in';

    if (element.tagName === 'IMG' || element.tagName === 'IFRAME' || element.tagName === 'VIDEO' || element.tagName === 'AUDIO') {
      element.addEventListener('load', () => {
        element.style.opacity = '1';
      }, { once: true });
      element.addEventListener('error', () => {
        element.style.opacity = '1';
      }, { once: true });
    } else if (mimeType.startsWith('text/')) {
      element.style.opacity = '1';
    }
    container.append(element);
  }
}
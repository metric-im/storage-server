export class FileExplorerCache {
  constructor() {
    this._cache = new Map();
  }

  get(pathKey) {
    return this._cache.get(pathKey);
  }

  set(pathKey, items) {
    this._cache.set(pathKey, items);
  }

  has(pathKey) {
    return this._cache.has(pathKey);
  }

  delete(pathKey) {
    this._cache.delete(pathKey);
  }

  updateItemInList(pathKey, tempItem, serverData) {
    if (this._cache.has(pathKey)) {
      let cachedItems = [...this._cache.get(pathKey)];
      const indexInCache = cachedItems.findIndex(item => item._tempId === tempItem._tempId);
      if (indexInCache !== -1) {
        cachedItems[indexInCache] = { ...cachedItems[indexInCache], optimistic: false, ...serverData };
      } else {
        cachedItems.push({ ...tempItem, optimistic: false, ...serverData });
        cachedItems.sort((a, b) => {
          const aIsDir = a.isDir;
          const bIsDir = b.isDir;
          return aIsDir === bIsDir ? a.name.localeCompare(b.name) : (aIsDir ? -1 : 1);
        });
      }
      this._cache.set(pathKey, cachedItems);
    } else {
      this.delete(pathKey); 
    }
  }

  removeItemFromList(pathKey, itemToDelete) {
    if (this._cache.has(pathKey)) {
      let cachedItems = [...this._cache.get(pathKey)];
      cachedItems = cachedItems.filter(i => i.key !== itemToDelete.key);
      this._cache.set(pathKey, cachedItems);
    }
  }
}
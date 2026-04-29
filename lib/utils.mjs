import path from 'path';
import MediaPresetsRaw from '../modules/MediaPresets.mjs';

// “foo/bar.png#raw” -> { path: "foo/bar.png", engine: "raw" }
export function parseRender(raw) {
    const [p, eng] = raw.split('#');
    return { path: p, engine: eng || 'raw' };
}

export function getKeyAndBase(param, uploadName) {
    const uploadExt = path.extname(uploadName).toLowerCase();
    const urlExt = path.extname(param).toLowerCase();
    const fullKey = (!urlExt || urlExt !== uploadExt)
        ? `${param}${uploadExt}`
        : param;
    const keyBase = fullKey.slice(0, -uploadExt.length);
    return { fullKey, keyBase };
}

const MAX_RENAME_ATTEMPTS = 1000;

// If keyBase is already taken (metadata exists), append " (1)", " (2)", ... to the
// basename until a free slot is found. Returns the resolved { fullKey, keyBase }.
// The extension is preserved verbatim from the input fullKey.
// Note: not atomic — a concurrent upload to the same resolved key in the narrow
// window between the getMeta probe and the storage.put will still overwrite.
export async function resolveUniqueKeyBase(storage, keyBase, fullKey) {
    if (!(await storage.getMeta(keyBase))) return { keyBase, fullKey };
    const ext = fullKey.slice(keyBase.length);
    const slashIdx = keyBase.lastIndexOf('/');
    const dir = slashIdx >= 0 ? keyBase.slice(0, slashIdx + 1) : '';
    const base = slashIdx >= 0 ? keyBase.slice(slashIdx + 1) : keyBase;
    for (let i = 1; i <= MAX_RENAME_ATTEMPTS; i++) {
        const candidateBase = `${dir}${base} (${i})`;
        if (!(await storage.getMeta(candidateBase))) {
            return { keyBase: candidateBase, fullKey: `${candidateBase}${ext}` };
        }
    }
    throw new Error(`Could not resolve unique key for "${keyBase}" after ${MAX_RENAME_ATTEMPTS} attempts`);
}

//stub ACL always allow for right now
export function checkAcl(connector, account, action) {
    return true;
}

export const TransformedMediaPresets = Object.fromEntries(
  Object.entries(MediaPresetsRaw).map(([key, { _id, name, options }]) => {
    const [, coords] = options.split('=');
    const [width, height, fit] = coords.split(',');
    return [_id, { id: _id, name, width: +width, height: +height, fit }];
  })
);
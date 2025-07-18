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

//stub ACL always allow for right now
export function checkAcl(connector, account, action) {
    return true;
}

export const TransformedMediaPresets = Object.fromEntries(
  Object.entries(MediaPresetsRaw).map(([key, { _id, options }]) => {
    const [, coords] = options.split('=');
    const [width, height, fit] = coords.split(',');
    return [_id, { id: _id, width: +width, height: +height, fit }];
  })
);
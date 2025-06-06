import path from 'path';

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
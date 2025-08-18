import express from 'express';
import path from 'path';
import { parseRender, getKeyAndBase, checkAcl, TransformedMediaPresets as MediaPresets } from '../lib/utils.mjs';
import crypto from 'crypto';

export default function itemRoutes(storage, connector) {
    const router = express.Router();

    const jsonParser = express.json();
    const rawUpload = express.raw({
        type: '*/*',
        limit: '50mb'
    });

    const MimeTypes = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'pdf': 'application/pdf',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mov': 'video/quicktime',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'txt': 'text/plain',
        'html': 'text/html',
        'json': 'application/json',
        'xml': 'application/xml',
        'jfif': 'image/jpeg',
        'svg': 'image/svg+xml'
    };

    router.put('/*filePath', jsonParser, async (req,res, next) => {
        if (!req.is('application/json')) return next();
        const param = Array.isArray(req.params.filePath) ? req.params.filePath.join('/') : req.params.filePath;
        const acct  = Array.isArray(req.params.filePath) ? req.params.filePath[0] : req.params.filePath.split('/')[0];
        if (!checkAcl(connector, acct, 'write')) return res.sendStatus(403);

        const fullKey = param;
        const existingMeta = (await storage.getMeta(fullKey)) || {};
        const now = new Date().toISOString();
        const mergedMeta = { ...existingMeta, ...req.body, _modified: now, _modifiedBy: connector.profile.userId };
        await storage.putMeta(fullKey, mergedMeta);
        return res.json(mergedMeta);
    });

    router.post('/*filePath', rawUpload, async (req, res) => {
        const param = Array.isArray(req.params.filePath)
            ? req.params.filePath.join('/')
            : req.params.filePath;
        const acct = Array.isArray(req.params.filePath) ? req.params.filePath[0] : req.params.filePath.split('/')[0];

        if (!checkAcl(connector, acct, 'write')) {
            return res.sendStatus(403);
        }
        const decodedFileName = decodeURIComponent(req.get('X-File-Name'));

        const upload = {
            name: decodedFileName,
            data: req.body,
            mimetype: req.get('Content-Type') || 'application/octet-stream'
        };

        if (!upload.name) {
            return res.status(400).json({ error: 'Missing X-File-Name header' });
        }

        const { fullKey, keyBase } = getKeyAndBase(param, upload.name);

        try {
            const hasher = crypto.createHash('md5');
            hasher.update(upload.data);
            const contentMD5 = hasher.digest('base64');
        
            await storage.put(fullKey, upload.data, upload.mimetype, contentMD5);

            const now  = new Date().toISOString();
            const hash = crypto.createHash('md5').update(upload.data).digest('hex');
            const ext  = path.extname(fullKey).slice(1);
            
            const newFileMeta = { 
                _created: now, 
                _createdBy: connector.profile.userId, 
                _hash: hash, 
                _ext: ext, 
                type: upload.mimetype,
                size: upload.data.length,
                originalFileKey: fullKey
            };
            await storage.putMeta(keyBase, newFileMeta);
            return res.status(201).json({ key: fullKey, meta: newFileMeta });
        } catch (e) {
            console.error('File upload POST error:', e);
            return res.status(500).json({ error: 'Internal Server Error', message: e.message });
        }
    });

    router.put('/*filePath', rawUpload, async (req, res) => {
        const param = Array.isArray(req.params.filePath)
            ? req.params.filePath.join('/')
            : req.params.filePath;
        const acct = Array.isArray(req.params.filePath) ? req.params.filePath[0] : req.params.filePath.split('/')[0];
        if (!checkAcl(connector, acct, 'write')) return res.sendStatus(403);

        const decodedFileName = decodeURIComponent(req.get('X-File-Name'));

        const upload = {
            name: decodedFileName,
            data: req.body,
            mimetype: req.get('Content-Type') || 'application/octet-stream'
        };

        if (!upload.name) return res.status(400).json({ error: 'Missing X-File-Name header' });

        const { fullKey, keyBase } = getKeyAndBase(param, upload.name);

        try {
            const hasher = crypto.createHash('md5');
            hasher.update(upload.data);
            const contentMD5 = hasher.digest('base64');
            await storage.putImage(keyBase, fullKey, upload.mimetype, upload.data, contentMD5); 
            
            const now = new Date().toISOString();
            const hash = crypto.createHash('md5').update(upload.data).digest('hex');
            const existingMeta = (await storage.getMeta(keyBase)) || {};
            const ext          = path.extname(fullKey).slice(1);
            
            const newMeta = { 
                ...existingMeta, 
                _modified: now, 
                _modifiedBy: connector.profile.userId, 
                _hash: hash, 
                _ext: ext, 
                type: upload.mimetype,
                size: upload.data.length,
                originalFileKey: fullKey
            };
            await storage.putMeta(keyBase, newMeta);
            return res.json({ key: fullKey, meta: newMeta });
        } catch (e) {
            console.error('File upload PUT error:', e);
            return res.status(500).json({ error: 'Internal Server Error', message: e.message });
        }
    });

    router.get('/meta/*filePath', async (req, res) => {
      const param = Array.isArray(req.params.filePath) ? req.params.filePath.join('/') : req.params.filePath;
      const acct = param.split('/')[0];
  
      if (!checkAcl(connector, acct, 'read')) {
        return res.sendStatus(403);
      }
  
      const keyBase = param.replace(/\.[^/.]+$/, '');
  
      try {
        const fileMetadata = await storage.getMeta(keyBase);

        if (fileMetadata) {
          return res.json({
            key: param,
            name: fileMetadata.name || keyBase.split('/').pop(),
            isDir: false,
            meta: fileMetadata
          });
        } else {
          return res.sendStatus(404);
        }
      } catch (error) {
        console.error('Error fetching metadata from backend:', error);
        return res.status(500).json({ error: 'Internal Server Error', message: error.message });
      }
    });

    router.get('/*filePath', async (req, res) => {
      const param = Array.isArray(req.params.filePath) ? req.params.filePath.join('/') : req.params.filePath;
      const acct = Array.isArray(req.params.filePath) ? req.params.filePath[0] : req.params.filePath.split('/')[0];
      if (!checkAcl(connector, acct, 'read')) return res.sendStatus(403);
      const parts = param.split('.');
      const lastPart = parts[parts.length - 1];
      let presetId = null;
      let keyBase = null;
      
      if (parts.length >= 3) {
        const secondToLastPart = parts[parts.length - 2];
        if (MediaPresets[secondToLastPart]) {
          presetId = secondToLastPart;
          keyBase = parts.slice(0, -2).join('.');
        }
      }
      if (!presetId && MediaPresets[lastPart]) {
        presetId = lastPart;
        keyBase = parts.slice(0, -1).join('.');
      }
      
      if (presetId && keyBase) {
        const preset = MediaPresets[presetId];
        try {
          let meta = null;
          try {
            meta = await storage.getMeta(keyBase);
          } catch (metaError) {
            console.warn(`Metadata not found for ${keyBase}, proceeding without meta:`, metaError.message);
          }
          const originalMimeType = meta ? meta.type : null;
          const originalFileKey = meta ? meta.originalFileKey : null;
          const buffer = await storage.getImage(keyBase, preset, originalMimeType, originalFileKey);
          if (!buffer) {
            return res.sendStatus(404);
          }
          return res.type('image/png').send(buffer);
        } catch (err) {
          if (err.message && err.message.includes('not found')) {
            return res.sendStatus(404);
          }
          console.error(`Error serving preset ${presetId} for ${keyBase}:`, err);
          return res.status(500).json({ error: 'Internal Server Error', message: err.message });
        }
      }
      const { path: parsedPath, engine } = parseRender(param);
      if (engine !== 'raw') return res.sendStatus(501);
      let fullKey = parsedPath;
      let fileMimeType = 'application/octet-stream';
      let fileName = path.basename(parsedPath);
      const metaLookupKey = path.extname(parsedPath) ? 
        parsedPath.replace(/\.[^/.]+$/, '') : 
        parsedPath;
      let meta = null;
      try {
        meta = await storage.getMeta(metaLookupKey);
      } catch (e) {
        console.warn(`Metadata not available for ${metaLookupKey}:`, e.message);
      }

      if (meta) {
        if (meta.originalFileKey) {
          fullKey = meta.originalFileKey;
        } else if (meta._ext) {
          fullKey = `${metaLookupKey}.${meta._ext}`;
        }
        if (meta.type) {
          fileMimeType = meta.type;
        } else if (MimeTypes[path.extname(fullKey).slice(1)]) {
          fileMimeType = MimeTypes[path.extname(fullKey).slice(1)];
        }
        if (meta.name) {
          fileName = meta.name;
        }
      } else {
        if (!path.extname(parsedPath)) {
          return res.sendStatus(404);
        } else {
          fileMimeType = MimeTypes[path.extname(parsedPath).slice(1)] || 'application/octet-stream';
        }
      }
      try {
        const data = await storage.get(fullKey);
        if (data) {
          res.setHeader('Content-Type', fileMimeType);
          res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
          return res.send(data);
        } else {
          return res.sendStatus(404);
        }
      } catch (storageError) {
        if (storageError.message && storageError.message.includes('not found')) {
          return res.sendStatus(404);
        }
        console.error(`Error retrieving file ${fullKey}:`, storageError);
        return res.status(500).json({ error: 'Internal Server Error', message: storageError.message });
      }
    });

    router.delete('/*filePath', async (req, res) => {
        const param = Array.isArray(req.params.filePath) ? req.params.filePath.join('/') : req.params.filePath;
        const acct = Array.isArray(req.params.filePath) ? req.params.filePath[0] : req.params.filePath.split('/')[0];
        if (!checkAcl(connector, acct, 'owner')) return res.sendStatus(403);
        
        const keyBase = param.replace(/\.[^/.]+$/, '');
        const deleteSuccess = await storage.remove(keyBase);
        return deleteSuccess ? res.sendStatus(204) : res.sendStatus(404);
    });

    return router;
}
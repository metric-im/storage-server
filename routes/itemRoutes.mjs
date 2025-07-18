import express from 'express';
import path from 'path';
import sharp from 'sharp';
import { parseRender, getKeyAndBase, checkAcl, TransformedMediaPresets as MediaPresets } from '../lib/utils.mjs';
import crypto from 'crypto';

export default function itemRoutes(storage, connector) {
    const router = express.Router();

    const jsonParser = express.json();
    const rawUpload = express.raw({
        type: '*/*',
        limit: '50mb'
    });

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

        const existingMeta = await storage.getMeta(keyBase);
        if (existingMeta) {
            return res.status(409).json({ error: 'File already exists', key: fullKey });
        }

        try {
            await storage.put(fullKey, upload.data, upload.mimetype);

            const now  = new Date().toISOString();
            const hash = crypto.createHash('md5').update(upload.data).digest('hex');
            const ext  = path.extname(fullKey).slice(1);
            
            const newFileMeta = { 
                _created: now, 
                _createdBy: connector.profile.userId, 
                _hash: hash, 
                _ext: ext, 
                type: upload.mimetype,
                size: upload.data.length
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
            await storage.putImage(keyBase, fullKey, upload.mimetype, upload.data);
            
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
                size: upload.data.length
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
      const urlExt = path.extname(param).slice(1);
      const preset = MediaPresets[urlExt];
      if (preset) {
        const keyBase = param.slice(0, -(urlExt.length + 1));
        try {
          let buffer = await storage.getImage(keyBase, preset);
          if (!buffer) {
            return res.sendStatus(500);
          }
          return res.type('image/png').send(buffer);
        } catch (err) {
          console.error(`Error serving preset ${urlExt} for ${keyBase}:`, err);
          return res.sendStatus(500);
        }
      }
      const { path: parsedPath, engine } = parseRender(param);
      if (engine !== 'raw') return res.sendStatus(501);
      let fullKey = parsedPath;
      let fileMimeType = 'application/octet-stream';
      let fileName = path.basename(parsedPath);
      const meta = await storage.getMeta(parsedPath);
      if (meta) {
        if (meta._ext) {
          fullKey = `${parsedPath}.${meta._ext}`;
        }
        if (meta.type) {
          fileMimeType = meta.type;
        }
        if (meta.name) {
          fileName = meta.name;
        }
      } else {
        if (!path.extname(parsedPath)) {
          return res.sendStatus(404);
        }
      }
      const data = await storage.get(fullKey);
      if (data) {
        res.setHeader('Content-Type', fileMimeType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
        return res.send(data);
      } else {
        return res.sendStatus(404);
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
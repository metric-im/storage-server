import express from 'express';
import path from 'path';
import sharp from 'sharp';
import MediaPresetsRaw from '../modules/MediaPresets.mjs';
import { parseRender, getKeyAndBase, checkAcl } from '../lib/utils.mjs';
import crypto from 'crypto';

const MediaPresets = Object.fromEntries(
  Object.entries(MediaPresetsRaw).map(([key, { _id, options }]) => {
    const [, coords] = options.split('=');
    const [width, height, fit] = coords.split(',');
    return [_id, { id: _id, width: +width, height: +height, fit }];
  })
);

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
            await storage.putImage(keyBase, fullKey, upload.mimetype, upload.data);

            const now  = new Date().toISOString();
            const hash = crypto.createHash('md5').update(upload.data).digest('hex');
            const ext  = path.extname(fullKey).slice(1);
            await storage.putMeta(keyBase, { _created: now, _createdBy: connector.profile.userId, _hash: hash, _ext: ext, type: upload.mimetype });
            return res.status(201).json({ key: fullKey });

        } catch (e) {
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
            const newMeta = { ...existingMeta, _modified: now, _modifiedBy: connector.profile.userId, _hash: hash, _ext: ext, type: upload.mimetype };
            await storage.putMeta(keyBase, newMeta); 

            await Promise.all(
                Object.values(MediaPresets).map(async preset => {
                    try {
                        const thumbnailBuffer = await sharp(upload.data)
                            .resize(preset.width, preset.height, { fit: preset.fit })
                            .png()
                            .toBuffer();
                        await storage.put(
                            `${keyBase}.${preset.id}`,
                            thumbnailBuffer,
                            'image/png'
                        );
                    } catch (presetError) {
                        throw presetError; 
                    }
                })
            );

            return res.json({ key: fullKey });
        } catch (e) {
            return res.status(500).json({ error: 'Internal Server Error', message: e.message });
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
                return res.sendStatus(500);
            }
        }

        const { path: parsedPath, engine } = parseRender(param);
        if (engine !== 'raw') return res.sendStatus(501);

        let fullKey = parsedPath;
        if (!path.extname(parsedPath)) { 
            const meta = await storage.getMeta(parsedPath); 
            if (!meta?._ext) {
                return res.sendStatus(404);
            }
            fullKey = `${parsedPath}.${meta._ext}`;
        }
        const data = await storage.get(fullKey);
        return data
            ? res.type('application/octet-stream').send(data)
            : res.sendStatus(404);
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
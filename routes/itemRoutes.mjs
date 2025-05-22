import express from 'express';
import path from 'path';
import { parseRender, getKeyAndBase, checkAcl } from '../lib/utils.mjs';

export default function itemRoutes(storage, connector) {
    const router = express.Router();

    router.post('/*filePath', async (req,res) => {
        const param = req.params.filePath;
        const acct  = param.split('/')[0];
        if (!checkAcl(connector, acct, 'write')) return res.sendStatus(403);
        if (!req.files?.file) return res.sendStatus(400);

        const upload = req.files.file;
        const { fullKey, keyBase } = getKeyAndBase(param, upload.name);

        await storage.putImage(keyBase, fullKey, upload.mimetype, upload.data);

        const now  = new Date().toISOString();
        const hash = crypto.createHash('md5').update(upload.data).digest('hex');
        const meta = { _created: now, _createdBy: connector.profile.userId, _hash: hash };
        await storage.putMeta(fullKey, meta);

        return res.status(201).json({ key: fullKey });
    });

    router.put('/*filePath', async (req,res) => {
        const raw = req.params.filePath;
        const acct = raw.split('/')[0];
        if (!checkAcl(connector, acct, 'write')) return res.sendStatus(403);

        const { path: param, engine } = parseRender(raw);
        const urlExt = path.extname(param).toLowerCase();

        if (req.is('application/json')) {
            let fullKey = param;
            if (!urlExt) {
                const existing = await storage.getMeta(param);
                if (!existing?._ext) return res.sendStatus(404);
                fullKey = `${param}.${existing._ext}`;
            }
            const now  = new Date().toISOString();
            const meta = { ...req.body, _modified: now, _modifiedBy: connector.profile.userId };
            await storage.putMeta(fullKey, meta);
            return res.json(meta);
        }

        if (req.files?.file) {
            const upload = req.files.file;
            const { fullKey, keyBase } = getKeyAndBase(param, upload.name);
            
            await storage.putImage(keyBase, fullKey, upload.mimetype, upload.data);
            
            const now  = new Date().toISOString();
            const hash = crypto.createHash('md5').update(upload.data).digest('hex');
            const meta = { _modified: now, _modifiedBy: connector.profile.userId, _hash: hash };
            await storage.putMeta(fullKey, meta);
            
            return res.json({ key: fullKey });
        }

        return res.sendStatus(400);
    });

    router.get('/*filePath', async (req,res) => {
        const raw = req.params.filePath;
        const acct = raw.split('/')[0];
        if (!checkAcl(connector, acct, 'read')) return res.sendStatus(403); 
        const { path: param, engine } = parseRender(raw);
        if (engine !== 'raw') {
            // TODO implement RenderEngine plugins
            return res.sendStatus(501);
        }
        let fullKey = param;
        if (!path.extname(param)) {
            const meta = await storage.getMeta(param);
            if (!meta?._ext) return res.sendStatus(404);
            fullKey = `${param}.${meta._ext}`;
        }
        const data = await storage.get(fullKey);
        return data ? res.type('application/octet-stream').send(data) : res.sendStatus(404);
    });

    router.delete('/*filePath', async (req, res) => {
        const raw   = req.params.filePath;
        const acct  = raw.split('/')[0];
        if (!checkAcl(connector, acct, 'owner')) return res.sendStatus(403);
        
        const keyBase = raw.replace(/\.[^/.]+$/, '');
        const ok = await storage.remove(keyBase);
        return ok ? res.sendStatus(204) : res.sendStatus(404);
    });

    return router;
}
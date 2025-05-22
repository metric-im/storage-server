import express from 'express';
import { checkAcl } from '../lib/utils.mjs';

export default function listRoutes(storage, connector) {
    const router = express.Router();

    const listHandler = async (req, res) => {
        const acct = req.params.account;
        if (!checkAcl(connector, acct, 'read')) return res.sendStatus(403);

        const rawPath = req.params.path || '';
        const parts = rawPath ? rawPath.split('/') : [];
        let wildcard = null;

        if (parts.length) {
            const last = parts[parts.length - 1];
            if (/[*?]/.test(last)) {
                wildcard = new RegExp('^' + last.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
                parts.pop();
            }
        }

        const prefix = [acct, ...parts].filter(Boolean).join('/');
        const items  = await storage.list(prefix);
        if (items == null) return res.sendStatus(404);
        if (!wildcard) return res.json(items);

        const out = {};
        for (const key in items) {
            const name = key.split('/').pop();
            if (wildcard.test(name)) out[key] = items[key];
        }
        return res.json(out);
    };
    router.get('/:account', listHandler);
    router.get('/:account/*path', listHandler);

    const createHandler = async (req, res) => {
        const acct = req.params.account;
        if (!checkAcl(connector, acct, 'write')) return res.sendStatus(403);

        const rawPath = req.params.path || '';
        const prefix = [acct, ...rawPath.split('/')].filter(Boolean).join('/');

        const exist = await storage.list(prefix);
        if (exist && Object.keys(exist).length) return res.sendStatus(409);

        await storage.put(prefix + '/', Buffer.alloc(0), 'application/x-directory');
        return res.status(201).json({ folder: prefix });
    };
    router.put('/:account', createHandler);
    router.put('/:account/*path', createHandler);
    router.post('/:account', createHandler);
    router.post('/:account/*path', createHandler);

    const deleteHandler = async (req, res) => {
        const acct = req.params.account;
        if (!checkAcl(connector, acct, 'owner')) return res.sendStatus(403);
        const rawPath = req.params.path || '';
        const prefix = [acct, ...rawPath.split('/')].filter(Boolean).join('/');
        const ok = await storage.remove(prefix);
        return ok ? res.sendStatus(204) : res.sendStatus(404);
    };
    router.delete('/:account', deleteHandler);
    router.delete('/:account/*path', deleteHandler);
    return router;
}

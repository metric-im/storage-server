/**
 * File storage handler supporting multiple hosting architectures
 */
import express from 'express';
import fileUpload from 'express-fileupload';
import Componentry from '@metric-im/componentry';
import axios from 'axios'
import sharp from 'sharp';
import crypto from 'crypto';
import StorageBridge from './modules/StorageBridge/index.mjs';

export default class StorageServer extends Componentry.Module {
    constructor(connector) {
        super(connector,import.meta.url)
    }

    static async mint(connector) {
        let instance = new StorageServer(connector);
        //TODO: this is suppressed as not yet implemented properly
//        instance.storage = await StorageBridge.mint(instance);
        return instance;
    }

    routes() {
        let router = express.Router();
        router.use(fileUpload({ limits: {fileSize: 50 * 1024 * 1024}}));
        router.get('/storage/list/:account/:path',async (req,res) => {
            try {
                let list = await this.storage.list()
                res.json();
            } catch(e) {
                console.error(e);
                res.send(e.message);
            }
        })

        return router;
    }

    notFound(req, res) {
        res.set('Content-Type','image/gif');
        res.contentLength = 43;
        res.end(this.pixel,'binary');
    }
}



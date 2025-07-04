/**
 * File storage handler supporting multiple hosting architectures
 */
import express from 'express';
import fileUpload from 'express-fileupload';
import Componentry from '@metric-im/componentry';
import axios from 'axios'
import sharp from 'sharp';
import crypto from 'crypto';
import dotenv from 'dotenv';
import StorageBridge from './modules/StorageBridge/index.mjs';
import listRoutes  from './routes/listRoutes.mjs';
import itemRoutes  from './routes/itemRoutes.mjs';

dotenv.config();

export default class StorageServer extends Componentry.Module {
    constructor(connector) {
        super(connector,import.meta.url)
    }

    static async mint(connector) {
        const server = new StorageServer(connector);
        server.storage = await StorageBridge.mint(server);
        return server;
    }

    routes() {
        const router = express.Router();
<<<<<<< HEAD
        router.use(
            '/storage/list',
            express.json(),
            listRoutes(this.storage, this.connector)
        );

        router.use(
            '/storage/item',
            itemRoutes(this.storage, this.connector)
        );
=======
        router.use(express.json());
        router.use(fileUpload({ limits: {fileSize: 50 * 1024 * 1024}}));
        router.use('/storage/list', listRoutes(this.storage, this.connector));
        router.use('/storage/item', itemRoutes(this.storage, this.connector));
        // router.use(this.notFound.bind(this));
>>>>>>> 82a6554 (adjust profile data)
        return router;
    }

    notFound(req, res) {
        res.set('Content-Type','image/gif');
        res.contentLength = 43;
        res.end(this.pixel,'binary');
    }
}
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
        /*
            environment variables for storj example:

            STORAGE_PROFILE=storj
            STORAGE_CREDENTIALS='{"STORJ":{
                "BUCKET":"metric-storage",
                "ACCESS_KEY":"",
                "SECRET":""
            }}'
        */
        if (!process.env.STORAGE_CREDENTIALS) {
            throw new Error("STORAGE_CREDENTIALS is required but not found in environment");
        }
        try {
            const storageCredentials = JSON.parse(process.env.STORAGE_CREDENTIALS);
            connector.profile = { ...connector.profile, ...storageCredentials };
        } catch (e) {
            throw e;
        }
        process.env.MEDIA_STORAGE = process.env.STORAGE_PROFILE;
        server.storage = await StorageBridge.mint(server);
        return server;
    }

    routes() {
        const router = express.Router();

        router.use(
            '/list',
            express.json(),
            listRoutes(this.storage, this.connector)
        );

        router.use(
            '/item',
            itemRoutes(this.storage, this.connector)
        );
        return router;
    }

    notFound(req, res) {
        res.set('Content-Type','image/gif');
        res.contentLength = 43;
        res.end(this.pixel,'binary');
    }
}
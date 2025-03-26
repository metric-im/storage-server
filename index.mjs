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
        instance.storage = await StorageBridge.mint(instance);
        return instance;
    }

    routes() {
        let router = express.Router();
        router.use(fileUpload({ limits: {fileSize: 50 * 1024 * 1024}}));
        /**
         * List gets all items that match the path.
         */
        router.get('/storage/image/list/*',async (req,res) => {
            try {
                let images = await this.storage.list(req.params[0]);
                res.json(images);
            } catch(e) {
                console.error(e);
                res.send(e.message);
            }
        })

        router.get('/media/image/url/*', async (req, res) => {
            try {
                const url = decodeURIComponent(req.params[0])

                let key = crypto.createHash('md5').update(url).digest('hex');
                let buffer = await axios('https://'+url,{responseType:'arraybuffer'});
                let spec = new Spec(key,req.query);
                let image = await sharp(buffer.data);
                image = await spec.process(image);
                res.set('Content-Type', 'image/png');
                res.send(image);
            } catch (e) {
                console.error(e);
                res.status(500).send();
            }
        });

        router.get('/media/image/id/*',async (req,res) => {
            try {
                let image = await this.storage.getImage(req.params[0],req.query);
                if (image) {
                    res.set('Content-Type', 'image/png');
                    if (image instanceof Uint8Array) { // There must be a better way to differentiate or normalize
                        res.send(image);
                    } else {
                        image.pipe(res);
                    }
                }
                else return this.notFound(req,res)
            } catch (e) {
                console.log(e)
                res.status(500).send();
            }
        });

        router.get('/media/image/rotate/*',async (req,res) => {
            try {
                const rotateDegree = +req.query?.rotateDegree
                if (!rotateDegree) res.status(400).json({message: 'Set the query param rotateDegree!'});
                await this.storage.rotate(req.params[0], rotateDegree);
                res.status(200).json({});
            } catch (e) {
                console.log(e)
                res.status(500).json({});
            }
        });

        router.delete('/media/image/*', async(req,res) => {
            try {
                if (!req.params[0]) res.status(400).json({'message': 'Image id is required'})
                let prefix, ids;
                let divider = req.params[0].lastIndexOf('/');
                if (divider >= 0) {
                    prefix = req.params[0].slice(0,divider);
                    ids = req.params[0].slice(divider+1);
                } else {
                    ids = req.params[0]
                }
                const isDeleted = await this.storage.remove(ids,prefix);
                if (isDeleted) {
                    res.status(200).send();
                } else {
                    res.status(400).json({'message': 'Image was not found or unexpected error'})
                }
            } catch (e) {
                console.log(e)
                res.status(500).send();
            }
        })

        //TODO: this needs work
        router.get('/media/image/import/:id/*', async (req, res) => {
            try {
                const url = decodeURIComponent(req.params[0])

                let key = crypto.createHash('md5').update(url).digest('hex');
                let buffer = await axios('https://'+url,{responseType:'arraybuffer'});
                let spec = new Spec(key,req.query);
                let image = await sharp(buffer.data);
                image = await spec.process(image);
                if (image) {
                    if (this.storage.host === 'aws') {
                        await this.connector.profile.S3Client.send(new this.aws.PutObjectCommand({
                            Bucket:this.connector.profile.aws.s3_bucket,
                            Key: spec.path,
                            ContentType: 'image/png',
                            Body: image
                        }))
                        let data = Buffer.from(image, 'base64');
                        res.send(data);
                    } else if (this.storage.host === 'database') {
                        // need to insert first.
                        let data = Buffer.from(image, 'base64');
                        res.send(data);
                    } else {
                        return res.status(404).send()
                    }
                } else {
                    return res.status(404).send()
                }
                res.set('Content-Type', 'image/png');
                res.send(image);
            } catch (e) {
                console.error(e);
                res.status(500).send();
            }
        });

        router.get('/media/props/*',async (req, res) => {
            try {
                let item = await this.storage.getJSON(req.params[0]);
                if (item) return res.json(item);
                else return this.notFound(req,res)
            } catch (e) {
                res.status(400).send();
            }
        })

        router.put('/media/props',async (req, res) => {
            if (!req.account) return res.status(401).send();
            if (!req.body._id) return res.status(404).send();
            try {
                req.body._modified = new Date();
                this.storage.putJSON(req.body._id, req.body);
                res.status(201).send();
            } catch (e) {
                console.error(e);
                res.status(500).send();
            }
        })

        router.put('/media/stage/:system?',async (req, res) => {
            if (!req.account) return res.status(401).send();
            try {
                let props = {};
                props.origin = req.body.origin || 'upload'; // alternative is 'url'
                props._id = req.body._id || this.connector.idForge.datedId();
                props.ext = req.body.type.split('/')[1];
                //TODO: keep created fields if this is replacing an existing root image
                props._created = new Date();
                props._createdBy = req.account.userId;
                if (req.body.captured) props.captured = req.body.captured;
                if (props.origin === 'upload') {
                    props.type = req.body.type;
                    props.size = req.body.size;
                } else if (props.origin === 'url') {
                    props.type = 'image/png';
                    props.url = req.body.url;
                }
                await this.storage.putJSON(props._id,props);
                res.json({_id:props._id,status:'staged'});
            } catch (e) {
                console.error(e);
                res.status(500).send();
            }
        })

        router.put('/media/upload/*',async (req, res) => {
            if (!req.account) return res.status(401).send();

            try {
                let itemId = req.params[0];
                if (!itemId) return res.status(400).send(`no identifier provided`);
                let properties = await this.storage.getJSON(itemId);
                if (!properties) return res.status(400).send(`${itemId} has not been staged`);
                await this.storage.remove(itemId);
                let imageProcessor = await ImageProcessor.fromUpload(itemId,req.files.file)
                imageProcessor.properties = properties
                await imageProcessor.save(this.storage);
                res.json({});
            } catch (e) {
                console.error('/media/upload/* error:', e);
                res.status(500).send();
            }
        });

        router.get('/media/noimage',(req, res) => {
            this.notFound(req,res);
        })

        return router;
    }

    notFound(req, res) {
        res.set('Content-Type','image/gif');
        res.contentLength = 43;
        res.end(this.pixel,'binary');
    }
}



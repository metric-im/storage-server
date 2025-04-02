/**
 * StorageHandler provides methods for accessing different mechanisms for
 * storing media.
 */
import ImageProcessor from './ImageProcessor.mjs';
import sharp from 'sharp';
export default class StorageBridge {
    static AWS = 'aws'
    static DATABASE = 'database'
    static STORJ = 'storj'

    static LIVE = 'live'
    static STAGED = 'staged'

    constructor(parent, options) {
        this.parent = parent;
        this.host = (process.env.MEDIA_STORAGE || StorageBridge.AWS).toLowerCase();
        this.collection = parent.collection
        this.imagePresets = options?.imagePresets || {}
    }
    static async mint(parent, options) {
        let instance = new StorageBridge(parent, options);
        this.handlers = {
            [this.AWS]:"./AWSStorage.mjs",
            [this.DATABASE]:"./DatabaseStorage.mjs",
            [this.STORJ]:"./StorjStorage.mjs",
        };
        let handler = await import(this.handlers[instance.host])
        return await handler.default.mint(parent, options);
    }
    async list(account){
        // see inheritors
    }
    async getItem(id) {
        return await this.parent.collection.findOne({_id:id});
    }
    async get(id, options) {

    }
    async putImage(id, image) {

    }
    async putProps(id,props) {

    }
    async getProps(id,props) {

    }
    async remove(id) {
        await this.parent.collection.deleteOne({_id:id});
    }
    async rotate(id) {
        console.log("shouldn't be here")
        // see inheritors
    }
}


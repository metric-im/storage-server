import { ListObjectsCommand,PutObjectCommand,GetObjectCommand,DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import AWSStorage from "./AWSStorage.mjs";

/**
 * Storj supports the AWS api so we use it here for convenience.
 * Encryption is server side, but otherwise, it is suitable for
 * the current clients of this module
 */
export default class StorjStorage extends AWSStorage {
    constructor(parent, options = {}) {
        super(parent, options);
    }
    initClient() {
        this.bucketName = this.connector.profile.STORJ.BUCKET || 'media';
        this.client = new S3Client({
            credentials: {
                accessKeyId: this.connector.profile.STORJ.ACCESS_KEY,
                secretAccessKey: this.connector.profile.STORJ.SECRET,
            },
            region: "us-1",
            endpoint: "https://gateway.storjshare.io",
        });
    }

    static async mint(parent, options) {
        return new StorjStorage(parent, options);
    }
}


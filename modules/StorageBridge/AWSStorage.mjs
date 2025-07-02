import sharp from 'sharp';
import path from 'path';
import Index from './index.mjs';
import { ListObjectsCommand,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { Md5 } from '@aws-sdk/md5-js'; // Added Md5 import for content MD5
import MediaPresetsRaw from '../MediaPresets.mjs';

const MediaPresets = Object.fromEntries(
  Object.entries(MediaPresetsRaw).map(([key, { _id, options }]) => {
    const [, coords] = options.split('=');
    const [width, height, fit] = coords.split(',');
    return [_id, { id: _id, width: +width, height: +height, fit }];
  })
);

export default class AWSStorage extends Index {

  constructor(parent, options = {}) {
    super(parent, options);
    this.connector = parent.connector;
    this.initClient();
  }
  initClient() {
    this.bucketName = this.connector.profile.aws.s3_bucket
    this.client = new S3Client({region:this.connector.profile.aws.s3_region});
  }

  static async mint(parent, options) {
    let instance = new AWSStorage(parent, options);
    const errorResponse = {
      'headers': {
        'Location': `https://${parent.connector.profile.S3_BUCKET}.s3.amazonaws.com/brokenImage.png`
      },
      'statusCode': 302,
      'isBase64Encoded': false
    };
    return instance;
  }

  async list(prefix) {
    let listCommand = new ListObjectsCommand({
      Bucket: this.bucketName,
      Prefix:prefix
    })
    let response = await this.client.send(listCommand);
    let items = {};
    for (let record of response.Contents || []) {
      const key = record.Key;
      // If it's an S3-style directory marker ("myfolder/")
      if (key.endsWith('/') && record.Size === 0) {
        const keyBase = key.slice(0, -1);
        if (!items[keyBase]) {
          items[keyBase] = { _id: keyBase, variants: {} };
        }
        items[keyBase].variants[''] = {
          type: 'application/x-directory',
          spec: ''
        };
        continue;
      }

      const keyBaseForMeta = key.substring(0, key.lastIndexOf('.'));
      const customMeta = await this.getMeta(keyBaseForMeta);

      if (!items[keyBaseForMeta]) {
        items[keyBaseForMeta] = { _id: keyBaseForMeta, variants: {} };
      }

      Object.assign(items[keyBaseForMeta], {
        size: record.Size,
        lastModified: record.LastModified.toISOString(),
        type: customMeta?.type || record.ContentType,
        variants: {
          '': {
            type: customMeta?.type || record.ContentType || 'application/octet-stream',
            spec: ''
          }
        },
        ...customMeta
      });

      const m = key.match(/(.*\/[A-Za-z0-9_-]+)\.(.+)$/);
      if (m) {
        const [, baseFromMatch, qualifier] = m;
        const [parsedType, parsedSpec] = qualifier.split('.').reverse();
        if (qualifier !== record.Key.substring(record.Key.lastIndexOf('.') + 1)) {
            items[keyBaseForMeta].variants[parsedSpec] = { type: parsedType, spec: parsedSpec };
        }
      }
    }
    return items;
  }
  async get(keyName) {
    let response = await this.sendS3Request(new GetObjectCommand({Bucket: this.bucketName, Key: keyName}));
    if (response.$metadata.httpStatusCode === 200) return await this.streamToBuffer(response.Body);
    else return null;
  }
  async put(keyName,buffer,type) {
    const hasher = new Md5();
    hasher.update(buffer);
    const contentMD5 = Buffer.from(await hasher.digest()).toString('base64');
    let response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: keyName,
      ContentType: type,
      Body: buffer,
      ContentMD5: contentMD5
    }))
    if (response.$metadata.httpStatusCode === 200) return buffer;
    else return null;
  }

  async getJSON(keyName) {
    try {
      const command = new GetObjectCommand({Bucket: this.bucketName, Key: keyName+'.json'})
      const response = await this.sendS3Request(command);
      if (response.$metadata.httpStatusCode === 200) {
        const buffer = await this.streamToBuffer(response.Body)
        return JSON.parse(buffer.toString());
      }
    } catch(e) {}
    return {};
  }
  
  async putMeta(keyName, data) {
    const body = JSON.stringify(data);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: `${keyName}._i`,
      ContentType: 'application/json',
      Body: body
    }));
  }

  async getMeta(keyName) {
    try {
      let resp = await this.client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: `${keyName}._i`
      }));
      if (resp.$metadata.httpStatusCode === 200) {
        const buffer = await this.streamToBuffer(resp.Body);
        return JSON.parse(buffer.toString());
      }
    } catch (e) {}
    return null;
  }

  async getImage(keyBase, preset) {
    const variantKey = `${keyBase}.${preset.id}`;
    // 1) Try cache
    const cached = await this.get(variantKey);
    if (cached) return cached;

    // 2) Load original
    let originalKey = keyBase;
    if (!path.extname(originalKey)) {
      const meta = await this.getMeta(keyBase) || {};
      if (!meta._ext) return null;
      originalKey = `${keyBase}.${meta._ext}`;
    }
    const originalBuffer = await this.get(originalKey);
    if (!originalBuffer) return null;

    // 3) Transform via Sharp
    let image = sharp(originalBuffer, { failOnError: false })
      .resize(preset.width, preset.height, { fit: preset.fit });
    image = image.png();
    const outputBuffer = await image.toBuffer();

    // 4) Cache & return
    await this.put(variantKey, outputBuffer, 'image/png');
    return outputBuffer;
  }

  async putJSON(id, data) {
    let json = (typeof data === 'object')?JSON.stringify(data):data;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: id+'.json', // for image === spec.path
      ContentType: 'application/json',
      Body: json
    }))
  }

  async putImage(id, file, fileType, buffer) {
    // When the source image changes, delete prior variants, so they are reconstructed.
    let variants = await this.client.send(new ListObjectsCommand({
      Bucket: this.bucketName,
      Prefix: `${id}`,
    }));
    if (variants.Contents) {
      // don't delete the properties file
      let files = variants.Contents.filter((file)=>!file.Key.endsWith('.json') && file.Key !== file);
      if (files.length > 0) {
        await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {Objects: files.map(f => ({ Key: f.Key }))}
        }));
      }
    }
    const hasher = new Md5();
    hasher.update(buffer);
    const contentMD5 = Buffer.from(await hasher.digest()).toString('base64');
    // Post the new object
    let response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: file, // for image === spec.path
      ContentType: fileType,
      Body: buffer,
      ContentMD5: contentMD5
    }))
    if (response.$metadata.httpStatusCode === 200) {
      return buffer;
    } else return null;
  }

  async sendS3Request(option) {
    try {
      return await this.client.send(option);
    } catch (e) {return  e}
  }

  streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async rotate(id, rotateDegree) {
    let image = await this.get(id)
    if (!image) return false

    image = await this.streamToBuffer(image)
    const buffer = await sharp(image).rotate(rotateDegree).toBuffer()

    const fileType = 'image/png';

    const isDeleted = await this.remove(id)
    if (!isDeleted) return false

    const url = await this.putImage(id, `${id}.png`, fileType, buffer)

    return Boolean(url)
  }

  async remove(ids, pathPrefix) {
    if (!ids) return false;
    if (typeof ids === 'string') ids = ids.split(',');

    let foundAny = false;

    for (let id of ids) {
      const prefix = pathPrefix ? `${pathPrefix}/${id}` : id;

      // list everything under prefix including "folder/" marker
      const listCommand = new ListObjectsCommand({
        Bucket: this.bucketName,
        Prefix: prefix,
      });
      const response = await this.client.send(listCommand);

      // delete each object individually
      for (let obj of response.Contents || []) {
        await this.client.send(new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: obj.Key
        }));
        foundAny = true;
      }
    }

    return foundAny;
  }
}

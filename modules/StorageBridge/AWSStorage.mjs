import sharp from 'sharp';
import path from 'path';
import StorageBridge from './index.mjs';
import { ListObjectsCommand,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { Md5 } from '@aws-sdk/md5-js';
import { TransformedMediaPresets as MediaPresets } from '../../lib/utils.mjs';

export default class AWSStorage extends StorageBridge {
  constructor(parent, options = {}) {
    super(parent, options);
    this.connector = parent.connector;
    this.initClient();
  }
  initClient() {
    this.bucketName = this.connector.profile.AWS.S3_BUCKET
    this.client = new S3Client({region:this.connector.profile.AWS.S3_REGION});
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
    const s3Prefix = prefix ? `${prefix}/` : '';
    let items = {};
    const excludedExtensions = new Set();

    for (const presetId in MediaPresets) {
      if (Object.prototype.hasOwnProperty.call(MediaPresets, presetId)) {
        const preset = MediaPresets[presetId];
        if (preset.id) {
          excludedExtensions.add(`.${preset.id.toLowerCase()}`);
          if (['tb', 'tw', 'icon', 'sez', 'gg', 'ob'].includes(preset.id.toLowerCase())) {
            excludedExtensions.add(`.${preset.id.toLowerCase()}.png`);
          }
        }
      }
    }
    excludedExtensions.add('._i');
    excludedExtensions.add('.meta');

    let dirResponse;
    try {
      let dirListCommand = new ListObjectsCommand({
        Bucket: this.bucketName,
        Prefix: s3Prefix,
        Delimiter: '/'
      });
      dirResponse = await this.client.send(dirListCommand);
    } catch (error) {
      console.error('Error listing directories from S3:', error);
      dirResponse = { CommonPrefixes: [] };
    }

    for (let commonPrefix of dirResponse.CommonPrefixes || []) {
      const key = commonPrefix.Prefix; // e.g., "bluefire/folder1/"
      const folderKeyBase = key.slice(0, -1); // e.g., "bluefire/folder1"
      const relativePath = folderKeyBase.substring(s3Prefix.length);
      const parts = relativePath.split('/');
      if (parts.length === 1 && parts[0] !== '') {
        const folderItem = {
          _id: folderKeyBase,
          key: folderKeyBase,
          name: parts[0],
          isDir: true,
          size: 0,
          lastModified: null,
          type: 'application/x-directory',
          meta: {
            type: 'application/x-directory',
          },
          variants: {}
        };
        items[folderKeyBase] = folderItem;
      }
    }

    let fileResponse;
    try {
      let fileListCommand = new ListObjectsCommand({
        Bucket: this.bucketName,
        Prefix: s3Prefix,
      });
      fileResponse = await this.client.send(fileListCommand);
    } catch (error) {
      fileResponse = { Contents: [] };
    }

    for (let record of fileResponse.Contents || []) {
      const key = record.Key;

      if (key.endsWith('/') && record.Size === 0) {
        continue;
      }
      if (key === s3Prefix) {
        continue;
      }
      if (typeof key !== 'string' || key.length === 0) {
        continue;
      }

      const fileName = key.split('/').pop();
      const fileNameLower = fileName.toLowerCase();
      let shouldExclude = false;
      for (const ext of excludedExtensions) {
        if (fileNameLower.endsWith(ext)) {
          shouldExclude = true;
          break;
        }
      }
      if (shouldExclude) {
        continue;
      }

      const relativePath = key.substring(s3Prefix.length);
      const parts = relativePath.split('/');
      if (parts.length === 1 && parts[0] !== '' && !relativePath.includes('/')) {
        const fileItem = {
          _id: key,
          key: key,
          name: parts[0],
          isDir: false,
          size: record.Size,
          lastModified: record.LastModified.toISOString(),
          type: record.ContentType || 'application/octet-stream',
          meta: {
            type: record.ContentType || 'application/octet-stream',
            size: record.Size,
            _lastModified: record.LastModified.toISOString()
          },
          variants: {
            '': {
              type: record.ContentType || 'application/octet-stream',
              spec: ''
            }
          }
        };
        items[key] = fileItem;
      }
    }

    const listItems = Object.values(items);
    return listItems;
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

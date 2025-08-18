import sharp from 'sharp';
import path from 'path';
import StorageBridge from './index.mjs';
import { ListObjectsCommand,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
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
          excludedExtensions.add(`.${preset.id.toLowerCase()}.png`);
        }
      }
    }
    excludedExtensions.add('._i');
    excludedExtensions.add('.meta');

    try {
      const dirResponse = await this.client.send(new ListObjectsCommand({
        Bucket: this.bucketName,
        Prefix: s3Prefix,
        Delimiter: '/'
      }));

      for (let commonPrefix of dirResponse.CommonPrefixes || []) {
        const key = commonPrefix.Prefix;
        const folderKeyBase = key.slice(0, -1);
        const relativePath = folderKeyBase.substring(s3Prefix.length);
        const parts = relativePath.split('/');
        
        if (parts.length === 1 && parts[0] !== '') {
          items[folderKeyBase] = {
            _id: folderKeyBase,
            key: folderKeyBase,
            name: parts[0],
            isDir: true,
            size: 0,
            lastModified: null,
            type: 'application/x-directory',
            meta: { type: 'application/x-directory' },
            variants: {}
          };
        }
      }
    } catch (error) {
      console.error('Error listing directories from S3:', error);
    }

    try {
      const fileResponse = await this.client.send(new ListObjectsCommand({
        Bucket: this.bucketName,
        Prefix: s3Prefix
      }));

      for (let record of fileResponse.Contents || []) {
        const key = record.Key;
        if (key.endsWith('/') && record.Size === 0) continue;
        if (key === s3Prefix) continue;
        if (typeof key !== 'string' || key.length === 0) continue;

        const fileName = key.split('/').pop();
        const fileNameLower = fileName.toLowerCase();
        let shouldExclude = false;
        for (const ext of excludedExtensions) {
          if (fileNameLower.endsWith(ext)) {
            shouldExclude = true;
            break;
          }
        }
        if (shouldExclude) continue;

        const relativePath = key.substring(s3Prefix.length);
        const parts = relativePath.split('/');
        
        if (parts.length === 1 && parts[0] !== '' && !relativePath.includes('/')) {
          items[key] = {
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
        }
      }
    } catch (error) {
      console.error('Error listing files from S3:', error);
    }
    return Object.values(items);
  }

  async get(keyName) {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: keyName
      }));
      
      if (response.$metadata.httpStatusCode === 200) {
        return await this.streamToBuffer(response.Body);
      }
      return null;
    } catch (error) {
      if (error.$metadata && error.$metadata.httpStatusCode === 404) {
        return null;
      }
      console.error(`Error getting ${keyName}:`, error);
      throw error;
    }
  }

  async put(keyName,buffer,type,precalculatedContentMD5) {
    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: keyName,
      ContentType: type,
      Body: buffer,
      ContentMD5: precalculatedContentMD5
    }));
    if (response.$metadata.httpStatusCode === 200) return buffer;
    else return null;
  }

  async putMeta(keyBase, data) {
    const metaKey = `${keyBase}._i`;
    const body = JSON.stringify(data);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: metaKey,
      ContentType: 'application/json',
      Body: body
    }));
  }

  async getMeta(keyBase) {
    const metaKey = `${keyBase}._i`;
    try {
      const resp = await this.client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: metaKey
      }));
      
      if (resp.$metadata.httpStatusCode === 200) {
        const buffer = await this.streamToBuffer(resp.Body);
        return JSON.parse(buffer.toString());
      }
    } catch (e) {
      if (e.$metadata && e.$metadata.httpStatusCode === 404) {
        return null;
      }
      console.error(`Error getting meta for ${keyBase}:`, e);
      throw e;
    }
    return null;
  }

  async clearVariants(keyBase) {
    const variantsToDelete = [];
    for (const presetId in MediaPresets) {
      if (Object.prototype.hasOwnProperty.call(MediaPresets, presetId)) {
        const commonOutputFormats = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
        for (const ext of commonOutputFormats) {
          const variantKey = `${keyBase}.${presetId}.${ext}`;
          variantsToDelete.push(variantKey);
        }
      }
    }

    const deletePromises = variantsToDelete.map(async (variantKey) => {
      try {
        await this.client.send(new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: variantKey
        }));
        return { key: variantKey, status: 'deleted' };
      } catch (error) {
        if (error.$metadata?.httpStatusCode === 404) {
          return { key: variantKey, status: 'not_found' };
        } else {
          return { key: variantKey, status: 'error', error: error.message };
        }
      }
    });

    const results = await Promise.allSettled(deletePromises);
    let deletedCount = 0;
    let errorCount = 0;
    let notFoundCount = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { status } = result.value;
        if (status === 'deleted') deletedCount++;
        else if (status === 'not_found') notFoundCount++;
        else if (status === 'error') errorCount++;
      } else {
        console.error(`[clearVariants] Promise failed for variant ${variantsToDelete[index]}:`, result.reason);
        errorCount++;
      }
    });
    return { deletedCount, errorCount, notFoundCount };
  }

  async putImage(keyBase, fullKey, mimetype, buffer, precalculatedContentMD5) {
    await this.put(fullKey, buffer, mimetype, precalculatedContentMD5);
    await this.clearVariants(keyBase);
  }

  async getImage(keyBase, preset, originalMimeType = null, originalFileKey = null) {
    if (!preset || !preset.id || typeof preset.id !== 'string') {
      console.error('Invalid preset object received:', preset);
      return null;
    }
    const variantKey = `${keyBase}.${preset.id}.png`;
    try {
      const cachedVariant = await this.get(variantKey);
      if (cachedVariant) return cachedVariant;
    } catch (error) {}
    let originalImageBuffer = null;
    let effectiveOriginalFileKey = originalFileKey;
    if (!effectiveOriginalFileKey) {
      try {
        const meta = await this.getMeta(keyBase);
        if (meta && meta.originalFileKey) {
          effectiveOriginalFileKey = meta.originalFileKey;
        } else if (meta && meta._ext) {
          effectiveOriginalFileKey = `${keyBase}.${meta._ext}`;
        }
      } catch (metaError) {
        console.warn(`Error fetching meta for keyBase ${keyBase}:`, metaError.message);
      }
    }
    if (effectiveOriginalFileKey) {
      try {
        originalImageBuffer = await this.get(effectiveOriginalFileKey);
      } catch (e) {
        console.error(`Error retrieving original image ${effectiveOriginalFileKey}:`, e.message);
      }
    }
    if (!originalImageBuffer) {
      const commonExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'jfif'];
      for (const ext of commonExtensions) {
        const potentialKey = `${keyBase}.${ext}`;
        try {
          originalImageBuffer = await this.get(potentialKey);
          if (originalImageBuffer) {
            effectiveOriginalFileKey = potentialKey;
            break;
          }
        } catch (e) {}
      }
    }
    if (!originalImageBuffer) {
      console.error(`Original image not found for keyBase: ${keyBase}`);
      return null;
    }
    try {
      const sharpInstance = sharp(originalImageBuffer, { failOnError: false })
        .resize(preset.width, preset.height, { 
          fit: preset.fit,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png();

      const generatedBuffer = await sharpInstance.toBuffer();
      await this.put(variantKey, generatedBuffer, 'image/png');
      return generatedBuffer;
    } catch (sharpErr) {
      console.error(`Error during Sharp transformation for ${keyBase} with preset ${preset.id}:`, sharpErr);
      return null;
    }
  }

  async remove(ids, pathPrefix) {
    if (!ids) return false;
    if (typeof ids === 'string') ids = [ids];
    let overallSuccess = false;
    for (const keyBase of ids) {
      const fullKeyBase = pathPrefix ? `${pathPrefix}/${keyBase}` : keyBase;
      const objectsToDelete = [];
      objectsToDelete.push({ Key: `${fullKeyBase}._i` });
      try {
        const meta = await this.getMeta(fullKeyBase);
        if (meta && meta.originalFileKey) {
          objectsToDelete.push({ Key: meta.originalFileKey });
        } else {
          const possibleExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'jfif'];
          for (const ext of possibleExtensions) {
            const potentialKey = `${fullKeyBase}.${ext}`;
            try {
              await this.client.send(new GetObjectCommand({
                Bucket: this.bucketName,
                Key: potentialKey
              }));
              objectsToDelete.push({ Key: potentialKey });
            } catch (e) {
            }
          }
        }
      } catch (e) {
        console.error(`Error fetching meta for ${fullKeyBase} during remove:`, e);
      }

      const presetIds = Object.keys(MediaPresets);
      const commonOutputFormats = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

      for (const presetId of presetIds) {
        for (const ext of commonOutputFormats) {
          objectsToDelete.push({ Key: `${fullKeyBase}.${presetId}.${ext}` });
        }
      }

      if (objectsToDelete.length > 0) {
        try {
          const deletePromises = objectsToDelete.map(obj => 
            this.client.send(new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: obj.Key
            })).catch(err => {
              if (err.$metadata?.httpStatusCode !== 404) {
                console.warn(`Error deleting ${obj.Key}:`, err.message);
              }
            })
          );
          
          await Promise.allSettled(deletePromises);
          overallSuccess = true;
        } catch (error) {
          console.error(`Error deleting objects for ${fullKeyBase}:`, error);
        }
      }
    }

    return overallSuccess;
  }

  streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}
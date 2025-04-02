import sharp from 'sharp';
import Index from './index.mjs';
import ImageProcessor from "./ImageProcessor.mjs";
import { ListObjectsCommand,PutObjectCommand,GetObjectCommand,DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';

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
    let test = new ListObjectsCommand({
      Bucket: this.bucketName,
      Prefix:prefix
    })
    let response = await this.client.send(test);
    let items = {};
    for (let record of response.Contents||[]) {
      let [key,_id,qualifier] = record.Key.match(/(.*\/[a-zA-Z0-9]+)\.(.*)/)||[];
      let [type,spec] = qualifier.split('.').reverse();
      if (!items[_id]) items[_id] = {_id:_id,variants:{}}
      items[_id].variants[spec] = {type:type,spec:spec};
      if (type === 'json') {
        let properties = await this.getJSON(_id)
        Object.assign(items[_id],properties);
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
    let response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: keyName,
      ContentType: type,
      Body: buffer
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

  async getImage(id, options) {
    let spec = new ImageProcessor(id, options);
    let test = new GetObjectCommand({Bucket: this.bucketName, Key: spec.path})
    let response = await this.sendS3Request(test);

    if (response.$metadata.httpStatusCode !== 200) {
      let spec = await ImageProcessor.fromSpec(id,options,this)
      let mainSpec = new ImageProcessor(spec.id);
      let mainTest = new GetObjectCommand({Bucket: this.bucketName, Key: mainSpec.path})
      response = await this.sendS3Request(mainTest);
      if (response.$metadata.httpStatusCode === 200) {
        spec.properties = await this.getJSON(spec.id);
        let buffer = await this.streamToBuffer(response.Body)
        buffer = await sharp(buffer,{failOnError: false});
        spec.buffer = await spec.process(buffer);
        await spec.save(this);
        buffer = await spec.buffer.toBuffer();
        return buffer;
      } else return null
    }
    return response.Body;
  }

  async putJSON(id, data) {
    let json = (typeof data === 'object')?JSON.stringify(data):data;
    let response = await this.client.send(new PutObjectCommand({
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
      let files = variants.Contents.filter((file)=>{!file.Key.endsWith('.json')});
      if (files.length > 0) {
        await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {Objects: files}
        }));
      }
    }
    // Post the new object
    let response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: file, // for image === spec.path
      ContentType: fileType,
      Body: buffer
    }))
    if (response.$metadata.httpStatusCode === 200) {
      return buffer;
    }
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

    const spec = new ImageProcessor(id)
    const fileType = 'image/png';

    const isDeleted = await this.remove(id)
    if (!isDeleted) return false
    const url = await this.putImage(id, spec.path, fileType, buffer)

    return Boolean(url)
  }

  async remove(ids,path) {
    if (!ids) return false;
    if (typeof ids === 'string') ids = ids.split(',');
    let files = [];
    for (let id of ids) {
      let listCommand = new ListObjectsCommand({
        Bucket: this.bucketName,
        Prefix:`${path?path+'/':''}${id}`
      });
      let response = await this.client.send(listCommand);
      files = files.concat(response.Contents);
    }

    let deleteCommand = new DeleteObjectsCommand({Bucket: this.bucketName, Delete: {
      Objects: files,
    }});
    let response = await this.client.send(deleteCommand);
    return response.$metadata.httpStatusCode === 200;
  }
}

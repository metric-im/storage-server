import sharp from "sharp";
import Index from "./index.mjs";
import ImageProcessor from "./ImageProcessor.mjs";

export default class DatabaseStorage extends Index {
  constructor(parent, options) {
    super(parent, options);
  }
  static async mint(parent) {
    return new DatabaseStorage(parent);
  }
  async list(account) {
    let search = new RegExp(`^${account}\/`)
    let query = {_id: {"$regex":`^${account}/`}};
    let list = await this.parent.collection.find(query).toArray();
    return list;
  }
  async get(id,options) {
    let spec = new ImageProcessor(id,options);
    let item = await this.getItem(id);
    let image = await sharp(Buffer.from(item.data,'base64'));
    image = await spec.process(image);
    return image;
  }
  async putImage(id,file,fileType,buffer) {
    let data = buffer.toString('base64');
    await this.parent.collection.findOneAndUpdate(
      {_id: id},
      {$set: {status: 'live', type: fileType, file: file, data: data,variants:[]}}
    );
  }
  async rotate(id) {
    let item = await this.getItem(id);
    if (!item) return null;
    let image = await sharp(Buffer.from(item.data,'base64'));
    let rotated = await image.rotate(90);
    let buffer = await rotated.toBuffer();
    await this.putImage(id,item.file,item.fileType,buffer);
  }
}

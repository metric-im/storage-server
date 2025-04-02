// This is here, but commented out so the new framework will compile while still recalling original code from the media mixin
export default class ImageProcessor {}


// import MediaPresets from "../../components/MediaPresets.mjs";
// import sharp from 'sharp';
//
// export default class ImageProcessor {
//     constructor(id, options) {
//         if (Object.keys(options||[]).length === 0) options = undefined;
//         let parts = id.split('.');
//         this.id = parts[0];
//         this.preset = MediaPresets[parts[1]];
//         // Either preset modifier on id, or query string options, or preset default
//         // Else modifier on id, or query string options or none
//         if (this.preset) options = parts[2] || options || this.preset.options;
//         else options = parts[1] || options;
//         this.variantId = this.preset?._id || options;
//         let spec = Object.fromEntries(new URLSearchParams(options).entries())
//         if (spec.crop) {
//             let data = spec.crop.split(',');
//             this.crop = {};
//             if (parseInt(data[0])) this.crop.left = parseInt(data[0]);
//             if (parseInt(data[1])) this.crop.top = parseInt(data[1]);
//             if (parseInt(data[2])) this.crop.width = parseInt(data[2]);
//             if (parseInt(data[3])) this.crop.height = parseInt(data[3]);
//         }
//         if (spec.scale) {
//             let data = spec.scale.split(',');
//             this.scale = {};
//             if (parseInt(data[0])) this.scale.width = parseInt(data[0]);
//             if (parseInt(data[1])) this.scale.height = parseInt(data[1]);
//             if (data[2]) this.scale.fit = data[2];
//             else this.scale.fit = 'cover';
//         }
//     }
//     static async fromUpload(id,fileInput,storage) {
//         let instance = new ImageProcessor(id);
//         instance.buffer = await sharp(fileInput.data, {failOnError: false});
//         instance.type = 'image/png';
//         let metadata = await instance.buffer.metadata();
//         instance.height = metadata.height;
//         instance.width = metadata.width;
//         instance.size = metadata.size;
//         return instance
//     }
//     static async fromSpec(id,spec,storage) {
//         let instance = new ImageProcessor(id,spec);
//         let rootBuffer = await storage.get(instance.id+'.png');
//         if (!rootBuffer) throw(new Error('not found'));
//         let optimizedBuffer = await sharp(rootBuffer,{failOnError: false});
//         instance.buffer = await instance.process(optimizedBuffer);
//
//         return instance
//     }
//     async save(storage) {
//         if (this.variantId) {
//             if (!this.properties.variants) this.properties.variants = [];
//             this.properties.variants[this.variantId] = {
//                 crop:this.crop,
//                 scale:this.scale
//             }
//         } else {
//             this.properties._id = this.id;
//             this.properties.height = this.height;
//             this.properties.width = this.width;
//             this.properties.size = this.size;
//             this.properties.type = this.type;
//         }
//         await storage.putJSON(this.id, this.properties);
//         const buffer = await storage.streamToBuffer(this.buffer);
//         await storage.put(this.path,buffer,this.type);
//     }
//     get path() {
//         let path = this.id;
//         if (this.preset) {
//             path += `.${this.preset._id}`;
//         } else {
//             let str = [];
//             if (this.scale) str.push(`scale=${this.scale.width||0},${this.scale.height||0},${this.scale.fit}`);
//             if (this.crop) str.push(`crop=${this.crop.left||''},${this.crop.top||''},${this.crop.width||''},${this.crop.height||''}`);
//             let spec = str.join('&');
//             if (spec) path += `.${spec}`;
//         }
//         return path+'.png';
//     }
//
//     get rootPath() {
//         return `${this.id}.png`;
//     }
//
//     async process(image) {
//         try {
//             if (this.scale) {
//                 image = await image.resize(this.scale);
//             }
//             if (this.crop) {
//                 let metadata = await image.metadata();
//                 let width = this.scale?this.scale.width:metadata.width;
//                 let height = this.scale?this.scale.height:metadata.height;
//                 let options = {};
//                 if (this.crop.left) options.left = Math.round(width * (this.crop.left/100));
//                 if (this.crop.top) options.top = Math.round(height * (this.crop.top/100));
//                 if (this.crop.width) options.width = Math.round(width * (this.crop.width/100));
//                 if (this.crop.height) options.height = Math.round(height * (this.crop.height/100));
//                 image = await image.extract(options);
//                 metadata = await image.metadata();
//                 this.height = metadata.height;
//                 this.width = metadata.width;
//                 this.size = metadata.size;
//             }
//             return await image;
//         } catch (e) {
//             throw new Error('image processing error: ' + e.message || e);
//         }
//     }
// }

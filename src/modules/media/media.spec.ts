import { ConfigService } from '@nestjs/config';
import { MediaService, verifyImage } from './media.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
describe('media input boundary',()=>{
  it('rejects SVG and oversized input before decoding or contacting storage',async()=>{
    await expect(verifyImage({buffer:Buffer.from('<svg/>'),mimetype:'image/svg+xml',size:6})).rejects.toThrow();
    await expect(verifyImage({buffer:Buffer.alloc(5242881),mimetype:'image/png',size:5242881})).rejects.toThrow();
  });
  it('verifies actual bytes rather than trusting a submitted image MIME type',async()=>{
    await expect(verifyImage({buffer:Buffer.from('not an image'),mimetype:'image/jpeg',size:12})).rejects.toThrow();
  });
  it('decodes and re-encodes a real image into bounded WebP output',async()=>{
    const {default:sharp}=await import('sharp');const buffer=await sharp({create:{width:8,height:4,channels:3,background:'#ffffff'}}).png().toBuffer();
    const result=await verifyImage({buffer,mimetype:'image/png',size:buffer.length});
    expect(result).toMatchObject({width:8,height:4});expect((await sharp(result.data).metadata()).format).toBe('webp');
    await expect(verifyImage({buffer,mimetype:'image/jpeg',size:buffer.length})).rejects.toThrow();
  });
  it('fails closed with storage disabled',async()=>{
    const service=new MediaService({} as PrismaService,new ConfigService({STORAGE_PROVIDER:'disabled'}));
    await expect(service.upload({buffer:Buffer.from('x'),mimetype:'image/png',size:1},'actor')).rejects.toThrow();
  });
});

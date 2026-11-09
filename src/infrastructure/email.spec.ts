import { ConfigService } from '@nestjs/config';
import { EmailService, openEmail, sealEmail } from './email.service.js';
import { integrationConfig } from './integration-config.js';
describe('optional delivery configuration and secret storage',()=>{
  const key='ab'.repeat(32),message={to:'fixture@example.com',subject:'Reset',text:'secret-reset-token'};
  it('encrypts token-bearing messages with randomized authenticated encryption',()=>{
    const a=sealEmail(message,key),b=sealEmail(message,key);expect(a).not.toBe(b);expect(a).not.toContain(message.text);expect(openEmail(a,key)).toEqual(message);
    const bytes=Buffer.from(a,'base64');bytes[bytes.length-1]^=1;expect(()=>openEmail(bytes.toString('base64'),key)).toThrow();expect(()=>openEmail(a,'cd'.repeat(32))).toThrow();
  });
  it('keeps services disabled and refuses partial configuration without exposing secrets',()=>{
    expect(integrationConfig({},'test')).toMatchObject({EMAIL_PROVIDER:'disabled',STORAGE_PROVIDER:'disabled',ASYNC_JOBS_ENABLED:false});
    expect(()=>new EmailService(new ConfigService({})).requireEnabled()).toThrow();
    expect(()=>integrationConfig({EMAIL_PROVIDER:'resend',RESEND_API_KEY:'private-key'},'test')).toThrow('Email requires');
    expect(()=>integrationConfig({STORAGE_PROVIDER:'s3'},'test')).toThrow('incomplete');
    expect(()=>integrationConfig({ASYNC_JOBS_ENABLED:'yes'},'test')).toThrow('ASYNC_JOBS_ENABLED');
    expect(()=>integrationConfig({ASYNC_JOBS_ENABLED:true,REDIS_URL:'redis://localhost/100'},'test')).toThrow('REDIS_URL');
  });
  it('rejects non-string provider selectors without invoking user-defined coercion',()=>{
    const toString=vi.fn(()=>{throw new Error('Unexpected coercion');});
    expect(()=>integrationConfig({EMAIL_PROVIDER:{toString}},'test')).toThrow('EMAIL_PROVIDER');
    expect(()=>integrationConfig({STORAGE_PROVIDER:{toString}},'test')).toThrow('STORAGE_PROVIDER');
    expect(toString).not.toHaveBeenCalled();
  });
  it('sanitizes provider failure responses and uses the same idempotency key on retry',async()=>{
    const call=vi.fn().mockResolvedValue({ok:false,body:{cancel:vi.fn()}});vi.stubGlobal('fetch',call);
    try {const service=new EmailService(new ConfigService({EMAIL_PROVIDER:'resend',EMAIL_FROM:'fixture@example.com',RESEND_API_KEY:'private-key'}));
      await expect(service.deliver(message,'event-1')).rejects.toThrow('confirmed provider response');
      await expect(service.deliver(message,'event-1')).rejects.not.toThrow('private-key');
      expect(call.mock.calls[0][1].headers['Idempotency-Key']).toBe(call.mock.calls[1][1].headers['Idempotency-Key']);
    }finally{vi.unstubAllGlobals();}
  });
});

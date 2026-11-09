export function integrationConfig(config:Record<string,unknown>,nodeEnv:string) {
  const provider=config.EMAIL_PROVIDER??'disabled';
  if(provider!=='disabled'&&provider!=='resend')throw new Error('EMAIL_PROVIDER must be disabled or resend.');
  const jobs=config.ASYNC_JOBS_ENABLED??'false';
  if(![true,false,'true','false'].includes(jobs as boolean|string))throw new Error('ASYNC_JOBS_ENABLED must be true or false.');
  const enabled=jobs===true||jobs==='true';
  if(enabled) {
    try {const url=new URL(String(config.REDIS_URL));if(!['redis:','rediss:'].includes(url.protocol)||!url.hostname||!/^\/(?:\d{1,2})?$/.test(url.pathname)||Number(url.pathname.slice(1))>15)throw new Error();}
    catch {throw new Error('ASYNC_JOBS_ENABLED requires a valid REDIS_URL.');}
  }
  if(provider==='resend') {
    if(!enabled||typeof config.RESEND_API_KEY!=='string'||!config.RESEND_API_KEY||typeof config.EMAIL_FROM!=='string'||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.EMAIL_FROM))throw new Error('Email requires async jobs, RESEND_API_KEY and EMAIL_FROM.');
    if(typeof config.EMAIL_ENCRYPTION_KEY!=='string'||!/^[a-fA-F0-9]{64}$/.test(config.EMAIL_ENCRYPTION_KEY))throw new Error('EMAIL_ENCRYPTION_KEY must contain 64 hexadecimal characters.');
    try {const url=new URL(String(config.STOREFRONT_URL));if(url.origin!==config.STOREFRONT_URL||!['http:','https:'].includes(url.protocol)||(nodeEnv==='production'&&url.protocol!=='https:'))throw new Error();}
    catch {throw new Error('Email requires a STOREFRONT_URL origin; production requires HTTPS.');}
  }
  const storage=config.STORAGE_PROVIDER??'disabled';
  if(storage!=='disabled'&&storage!=='s3')throw new Error('STORAGE_PROVIDER must be disabled or s3.');
  const pathStyle=config.S3_FORCE_PATH_STYLE??'false';
  if(![true,false,'true','false'].includes(pathStyle as boolean|string))throw new Error('S3_FORCE_PATH_STYLE must be true or false.');
  if(storage==='s3') {
    if(['S3_REGION','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY'].some(key=>typeof config[key]!=='string'||!(config[key] as string).trim()))throw new Error('S3 storage configuration is incomplete.');
    for(const name of ['MEDIA_PUBLIC_URL','S3_ENDPOINT']) {
      if(name==='S3_ENDPOINT'&&!config[name])continue;
      try {const url=new URL(String(config[name]));if(!['https:','http:'].includes(url.protocol)||(nodeEnv==='production'&&url.protocol!=='https:')||url.username||url.password||url.search||url.hash)throw new Error();}
      catch {throw new Error(`${name} must be an HTTP URL without credentials, query or fragment; production requires HTTPS.`);}
    }
  }
  return {EMAIL_PROVIDER:provider,ASYNC_JOBS_ENABLED:enabled,STORAGE_PROVIDER:storage,S3_FORCE_PATH_STYLE:pathStyle===true||pathStyle==='true',MEDIA_PUBLIC_URL:typeof config.MEDIA_PUBLIC_URL==='string'?config.MEDIA_PUBLIC_URL.replace(/\/+$/,''):undefined};
}

// Host-side egress: private Unix socket per user, scoped internal API, public internet only.
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { chmodSync, unlinkSync } from 'node:fs';
const { YINGYA_GATEWAY_SOCKET: socketPath, YINGYA_SERVICE_TOKEN: token, YINGYA_BACKEND_BASE: backend } = process.env;
const upstreamValue = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const upstream = upstreamValue ? new URL(upstreamValue) : null;
// These providers own their DNS; retain hostnames for domain-routed development proxies.
const providerDomains = ['openai.com','chatgpt.com','oaistatic.com','oaiusercontent.com','jsdelivr.net','unpkg.com','googleapis.com','gstatic.com','github.com','githubusercontent.com','npmjs.org','npmjs.com','heygen.com','pexels.com','pixabay.com','unsplash.com'];
function providerHost(host) { return providerDomains.some(domain => host === domain || host.endsWith(`.${domain}`)); }
function publicIP(ip) {
  if (net.isIPv4(ip)) { const [a,b] = ip.split('.').map(Number); return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))); }
  // Require globally routable IPv6; mapped IPv4 and local ranges are rejected.
  return net.isIPv6(ip) && /^[23][0-9a-f]{3}:/i.test(ip);
}
async function target(host, port) {
  if (![80,443].includes(Number(port))) throw new Error('Only public HTTP(S) destinations are allowed');
  const addresses=await dns.lookup(host,{all:true});
  if (!addresses.length || addresses.some(x=>!publicIP(x.address))) throw new Error('Private network destination denied');
  return addresses[0].address;
}
function proxyAuth() { return upstream?.username ? { 'proxy-authorization':`Basic ${Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString('base64')}` } : {}; }
function clean(headers) { const copy={...headers}; for(const k of ['authorization','cookie','proxy-authorization','connection','upgrade','x-yingya-user'])delete copy[k]; return copy; }
const server=http.createServer(async(req,res)=>{
 try {
  const url = new URL(req.url,`http://${req.headers.host || '127.0.0.1:8797'}`);
  let options;
  if (['127.0.0.1','localhost'].includes(url.hostname) && ['8797','8791'].includes(url.port)) {
    if(url.port==='8797' && !url.pathname.startsWith('/api/') && url.pathname!=='/health')throw new Error('Internal route denied');
    const base=new URL(backend);
    const path=url.port==='8791' ? `/api/internal/voice${url.pathname}` : url.pathname;
    options={hostname:base.hostname,port:base.port,path:path+url.search,method:req.method,headers:{...clean(req.headers),host:base.host,authorization:`Bearer ${token}`}};
  } else {
    if(url.protocol!=='http:')throw new Error('Use CONNECT for HTTPS');
    const address=await target(url.hostname,url.port||80);
    const pinned=new URL(url);pinned.hostname=net.isIPv6(address)?`[${address}]`:address;
    options=upstream ? {hostname:upstream.hostname,port:upstream.port||80,path:pinned.href,method:req.method,headers:{...clean(req.headers),host:url.host,...proxyAuth()}} : {hostname:address,port:url.port||80,path:url.pathname+url.search,method:req.method,headers:{...clean(req.headers),host:url.host}};
    // Preserve provider authorization only for public destinations.
    if(req.headers.authorization)options.headers.authorization=req.headers.authorization;
  }
  const out=http.request(options, incoming=>{res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);});
  out.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Gateway unavailable');});
  req.pipe(out);
 }catch {res.writeHead(403);res.end('Sandbox destination denied');}
});
server.on('connect', async(req,client,head)=>{
 try {
  const url=new URL(`https://${req.url}`);const address=await target(url.hostname,url.port||443);
  if(upstream){
    const connect=http.request({hostname:upstream.hostname,port:upstream.port||80,method:'CONNECT',path:providerHost(url.hostname)?req.url:`${net.isIPv6(address)?`[${address}]`:address}:${url.port||443}`,headers:{host:req.url,...proxyAuth()}});
    connect.on('connect',(response,remote,extra)=>{if(response.statusCode!==200){client.destroy();remote.destroy();return;}client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);if(extra.length)client.write(extra);client.pipe(remote).pipe(client);remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());});
    connect.on('error',()=>client.destroy());connect.end();
  }else{
    const remote=net.connect(Number(url.port||443),address,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote).pipe(client);});
    remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());
  }
 }catch{client.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
});
server.on('clientError',(_,socket)=>socket.destroy());
server.listen(socketPath,()=>{chmodSync(socketPath,0o600);console.log('ready');});

function cleanup() { try { unlinkSync(socketPath); } catch {} process.exit(0); }
process.on('SIGTERM', cleanup); process.on('SIGINT', cleanup);
setInterval(() => { if (process.ppid === 1) cleanup(); }, 5000).unref();

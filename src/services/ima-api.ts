import type { KnowledgeBase } from '../types';

const BASE_URL = 'https://ima.qq.com';
const SKILL_VERSION = '1.1.7';

/**
 * IMA OpenAPI 调用底层封装
 * 文档：ima-skills SKILL.md
 */
async function imaFetch(
  apiPath: string,
  body: Record<string, any>,
  clientId: string,
  apiKey: string,
): Promise<any> {
  const url = `${BASE_URL}/${apiPath}`;
  if (__DEV__) console.log('[IMA API] 请求:', url, JSON.stringify(body));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'ima-openapi-clientid': clientId,
        'ima-openapi-apikey': apiKey,
        'ima-openapi-ctx': `skill_version=${SKILL_VERSION}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error('IMA API 请求超时 (30s)');
    }
    if (__DEV__) console.error('[IMA API] 网络请求失败:', e.message);
    throw new Error(`IMA 网络请求失败: ${e.message}`);
  }
  clearTimeout(timer);

  const text = await res.text();
  if (__DEV__) console.log('[IMA API] HTTP', res.status, '响应:', text.slice(0, 500));

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    if (__DEV__) console.error('[IMA API] 非JSON响应:', text.slice(0, 200));
    throw new Error(`IMA API 返回异常 (HTTP ${res.status}): ${text.slice(0, 100)}`);
  }

  if (data.code !== 0) {
    const errMsg = data.msg || '未知错误';
    if (__DEV__) console.error(`[IMA API] 业务错误 code=${data.code}: ${errMsg}`);
    if (data.code === 200002) {
      throw new Error('IMA 认证失败：Client ID 或 API Key 错误。请访问 ima.qq.com/agent-interface 重新获取');
    }
    throw new Error(`IMA: ${errMsg} (code=${data.code})`);
  }

  return data.data ?? {};
}

/** 获取知识库列表 — 对照书迹桌面版 Rust 实现 */
export async function fetchKnowledgeBases(
  clientId: string,
  apiKey: string,
): Promise<KnowledgeBase[]> {
  if (!clientId || !apiKey) {
    throw new Error('请先填写 IMA Client ID 和 API Key');
  }

  if (__DEV__) console.log('[IMA API] 开始获取知识库列表 (search_knowledge_base)');

  return await fetchKBsFromEndpoint(
    'openapi/wiki/v1/search_knowledge_base',
    clientId, apiKey,
    { query: '' },
  );
}

/** 通用知识库列表分页拉取 — 对照书迹桌面版 Rust 实现 */
async function fetchKBsFromEndpoint(
  apiPath: string,
  clientId: string,
  apiKey: string,
  extraParams: Record<string, any> = {},
): Promise<KnowledgeBase[]> {
  const allItems: KnowledgeBase[] = [];
  let nextCursor = '';
  let isEnd = false;

  while (!isEnd) {
    const body: Record<string, any> = { ...extraParams, cursor: nextCursor, limit: 20 };
    const respData = await imaFetch(apiPath, body, clientId, apiKey);

    // 解析 KB 列表 — 响应字段名：addable_knowledge_base_list（书迹实测）
    // 回退兼容：info_list / knowledge_bases / list / items
    const itemsArr: any[] = ([] as any[]).concat(
      respData?.addable_knowledge_base_list ||
      respData?.info_list ||
      respData?.knowledge_bases ||
      respData?.list ||
      respData?.items ||
      [],
    );

    if (__DEV__) console.log(`[IMA API] ${apiPath} 本页 ${itemsArr.length} 条 (字段: ${Object.keys(respData || {}).join(',')})`);

    // 解析单个 KB — 字段名：id / kb_id, name / kb_name（书迹实测）
    for (const item of itemsArr) {
      const kbId = String(
        item.id || item.kb_id || item.knowledge_base_id || item.knowledgeBaseId || '',
      );
      const kbName = String(
        item.name || item.kb_name || item.title || item.basic_info?.name || '',
      );
      // 过滤：仅保留"个人知识库"且角色为"创建者"
      const roleType = String(item.role_type || item.roleType || '');
      const baseType = String(item.base_type || item.baseType || '');
      if (roleType === '创建者' && baseType === '个人知识库') {
        if (kbId) {
          allItems.push({ id: kbId, name: kbName || kbId });
        }
      } else if (kbId && !roleType && !baseType) {
        // 无 role/base 字段时，直接纳入（兼容不同 API 格式）
        allItems.push({ id: kbId, name: kbName || kbId });
      } else {
        if (__DEV__) console.log(`[IMA API] 跳过非个人知识库: "${kbName}" (role=${roleType}, base=${baseType})`);
      }
    }

    // 游标分页 — 字段在顶层（书迹实测）
    nextCursor = String(respData?.next_cursor || respData?.nextCursor || '');
    isEnd = respData?.is_end === true || respData?.isEnd === true || (nextCursor === '' && itemsArr.length === 0);
  }

  if (__DEV__) console.log(`[IMA API] ${apiPath} 共 ${allItems.length} 个知识库`);
  return allItems;
}

/** 验证 IMA API Key 是否有效（通过获取知识库列表来判断） */
export async function validateImaCredentials(
  clientId: string,
  apiKey: string,
): Promise<{ valid: boolean; message?: string }> {
  try {
    await fetchKnowledgeBases(clientId, apiKey);
    return { valid: true };
  } catch (e: any) {
    return { valid: false, message: e.message };
  }
}

/** 创建一篇 IMA 笔记 — 对齐书迹桌面版 API
 * POST /openapi/note/v1/import_doc
 * 参数: content_format=1 (Markdown), content=markdown文本
 * 不传 title — 标题嵌入在 content 第一行的 # 标题中
 */
export async function createImaNote(
  clientId: string,
  apiKey: string,
  title: string,
  content: string,
): Promise<string> {
  if (!clientId || !apiKey) {
    throw new Error('请先在设置中配置 IMA API Key 和 Client ID');
  }

  const data = await imaFetch(
    'openapi/note/v1/import_doc',
    { content_format: 1, content },
    clientId,
    apiKey,
  );

  // 对齐书迹 parse_note_id: note_id → noteId → content_id → contentId
  return data?.note_id || data?.noteId || data?.content_id || data?.contentId || '';
}

/** 将笔记添加到知识库 — 对齐书迹桌面版 API
 * POST /openapi/wiki/v1/add_knowledge
 * 参数: media_type=11, note_info={content_id}, title, knowledge_base_id
 */
export async function addNoteToKnowledgeBase(
  clientId: string,
  apiKey: string,
  knowledgeBaseId: string,
  noteId: string,
  title: string,
): Promise<void> {
  await imaFetch(
    'openapi/wiki/v1/add_knowledge',
    {
      media_type: 11, // 笔记类型
      note_info: { content_id: noteId },
      title,
      knowledge_base_id: knowledgeBaseId,
    },
    clientId,
    apiKey,
  );
}

// ====== 文件上传到个人知识库（直接进知识库，不经过笔记） ======
// 对齐 ima-knowledge skill 的 upload_file.py：create_media → COS PUT → add_knowledge(media_id)
// 采用纯 JS HMAC-SHA1（无第三方依赖，已与 Python 标准 hmac 交叉验证一致）

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function sha1Bytes(msgBytes: number[]): string {
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const ml = msgBytes.length * 8;
  const msg = msgBytes.slice();
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  msg.push(0, 0, 0, 0); // 高 32 位（文件 < 512MB，ml < 2^32）
  msg.push((ml >>> 24) & 0xff, (ml >>> 16) & 0xff, (ml >>> 8) & 0xff, ml & 0xff); // 低 32 位
  const w = new Array(80);
  for (let i = 0; i < msg.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = (msg[i + j * 4] << 24) | (msg[i + j * 4 + 1] << 16) | (msg[i + j * 4 + 2] << 8) | msg[i + j * 4 + 3];
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl32(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const tmp = (rotl32(a, 5) + f + e + k + w[j]) | 0;
      e = d; d = c; c = rotl32(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  let out = '';
  for (const h of [h0, h1, h2, h3, h4]) {
    for (let i = 0; i < 4; i++) out += ((h >>> (24 - i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

function strToUtf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function hmacSha1(key: string, msg: string): string {
  const blockSize = 64;
  let keyBytes = strToUtf8Bytes(key);
  if (keyBytes.length > blockSize) keyBytes = strToUtf8Bytes(sha1Bytes(keyBytes));
  if (keyBytes.length < blockSize) while (keyBytes.length < blockSize) keyBytes.push(0);
  const iKey = keyBytes.map((b) => b ^ 0x36);
  const oKey = keyBytes.map((b) => b ^ 0x5c);
  const msgBytes = strToUtf8Bytes(msg);
  const inner = sha1Bytes(iKey.concat(msgBytes));
  const innerBytes: number[] = [];
  for (let i = 0; i < inner.length; i += 2) innerBytes.push(parseInt(inner.substr(i, 2), 16));
  return sha1Bytes(oKey.concat(innerBytes));
}

function buildCosAuthorization(
  secretId: string, secretKey: string, method: string, pathname: string,
  headers: Record<string, string>, startTime: string, expiredTime: string,
): string {
  const keyTime = `${startTime};${expiredTime}`;
  const signKey = hmacSha1(secretKey, keyTime);
  const headerKeys = Object.keys(headers).sort();
  const httpHeaders = headerKeys.map((k) => `${k.toLowerCase()}=${encodeURIComponent(headers[k])}`).join('&');
  const httpString = `${method.toLowerCase()}\n${pathname}\n\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1Bytes(strToUtf8Bytes(httpString))}\n`;
  const signature = hmacSha1(signKey, stringToSign);
  const headerList = headerKeys.map((k) => k.toLowerCase()).join(';');
  return `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;
}

export interface CosCredential {
  secret_id: string;
  secret_key: string;
  token: string;
  bucket_name: string;
  region: string;
  cos_key: string;
  start_time: number;
  expired_time: number;
}

/** 创建媒体（文件上传第1步）：向 IMA 申请 COS 上传凭证 */
export async function createMedia(
  clientId: string,
  apiKey: string,
  knowledgeBaseId: string,
  fileName: string,
  fileSize: number,
  mediaType: number,
  contentType: string,
  fileExt: string,
): Promise<{ mediaId: string; cosCredential: CosCredential }> {
  const data = await imaFetch(
    'openapi/wiki/v1/create_media',
    {
      media_type: mediaType,
      file_name: fileName,
      file_size: fileSize,
      content_type: contentType,
      knowledge_base_id: knowledgeBaseId,
      file_ext: fileExt,
    },
    clientId,
    apiKey,
  );
  return { mediaId: data.media_id, cosCredential: data.cos_credential };
}

/** 上传文件内容到 COS（文件上传第2步），带 HMAC-SHA1 签名 */
export async function uploadToCos(
  cosCredential: CosCredential,
  content: string,
  contentType: string,
): Promise<void> {
  const { secret_id, secret_key, token, bucket_name, region, cos_key, start_time, expired_time } = cosCredential;
  const bytes = new Uint8Array(strToUtf8Bytes(content));
  const byteLength = bytes.length;
  const hostname = `${bucket_name}.cos.${region}.myqcloud.com`;
  const pathname = `/${cos_key}`;
  const signHeaders: Record<string, string> = {
    'content-length': String(byteLength),
    'host': hostname,
  };
  const authorization = buildCosAuthorization(
    secret_id, secret_key, 'PUT', pathname, signHeaders, String(start_time), String(expired_time),
  );
  const url = `https://${hostname}${pathname}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Authorization': authorization,
        'x-cos-security-token': token,
      },
      body: bytes,
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') throw new Error('COS 上传超时 (60s)');
    throw new Error(`COS 上传网络失败: ${e?.message}`);
  }
  clearTimeout(timer);
  if (!(res.status >= 200 && res.status < 300)) {
    const t = await res.text().catch(() => '');
    throw new Error(`COS 上传失败 (HTTP ${res.status}): ${t.slice(0, 200)}`);
  }
}

/** 添加文件到知识库（文件上传第3步）：直接进个人知识库，不经过笔记 */
export async function addKnowledgeToKb(
  clientId: string,
  apiKey: string,
  knowledgeBaseId: string,
  mediaId: string,
  title: string,
  mediaType: number,
  folderId?: string,
): Promise<void> {
  const body: Record<string, any> = {
    media_type: mediaType,
    media_id: mediaId,
    title,
    knowledge_base_id: knowledgeBaseId,
  };
  if (folderId) body.folder_id = folderId;
  await imaFetch('openapi/wiki/v1/add_knowledge', body, clientId, apiKey);
}

/** 计算 UTF-8 字节长度（create_media 需要 file_size） */
export function utf8ByteLength(s: string): number {
  return strToUtf8Bytes(s).length;
}

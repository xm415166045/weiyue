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
